// @usejinn/sdk: the TypeScript client for Jinn's API (https://api.usejinn.com/v1).
// It uses fetch and Web Crypto only, so it runs in Node 20+, Deno, Bun and browsers.
//
//   const jinn = new Jinn({ key: process.env.JINN_KEY! });
//   const input = await jinn.upload(await pack({ "ticket.json": JSON.stringify(ticket) }));
//   let run = await jinn.startRun("fnc_…", { prompt: "Answer this ticket.", input });
//   run = await jinn.wait(run.id);
//   const files = await unpack(await jinn.output(run)); // { "reply.md": Uint8Array, … }

export const DEFAULT_BASE_URL = "https://api.usejinn.com";

export interface ManifestEntry { path: string; description?: string; max_bytes: number }
export interface CustomTool {
  name: string; description: string; parameters: Record<string, unknown>; url: string;
  /** Sent once; later versions send the secret_id Jinn returned. */
  secret?: string; secret_id?: string; timeout_seconds: number;
}
export interface EnvVar { name: string; value?: string; secret?: string; secret_id?: string }
export type Size = "s" | "m" | "l" | "xl";
/** A function's definition. The lists are optional; a list left out is empty. */
export interface Definition {
  /** One of bases(). */
  base: string;
  /** Run as root before the agent, each in bash -euo pipefail -c. */
  setup?: string[];
  /** prv_…@3 or prv_…@latest. */
  provider: string;
  system_prompt: string;
  tools?: ("bash" | "read" | "write" | "edit" | "screenshot" | "web_search")[];
  custom_tools?: CustomTool[];
  input_manifest?: ManifestEntry[];
  output_manifest?: ManifestEntry[];
  environment?: EnvVar[];
  size: Size;
  /** 1 to 1440. Setup counts towards it. */
  timeout_minutes: number;
}
export interface Version extends Definition {
  function: string; version: number; external_reference?: string; created_at: string; created_by: string;
}
export interface FunctionHead { id: string; name: string; latest: number; updated_at: string }
export interface FunctionSummary extends FunctionHead { definition: Version; last: Run | null }

export type Failure = "input" | "no_submission" | "timeout" | "provider" | "infrastructure" | "setup" | "suspended";
export interface Run {
  id: string; account: string; function: string; version: number; base: string; size: Size; provider: string;
  prompt: string; input?: string; webhook?: string; external_reference?: string;
  state: "queued" | "running" | "succeeded" | "failed";
  created_at: string; created_by: string; started_at?: string; ended_at?: string;
  failure?: Failure; detail?: string; message?: string;
  /** A succeeded run's output folder as one .tar.gz; url works for 15 minutes. */
  output?: { sha256: string; bytes: number; file_count: number; url: string; files: { path: string; bytes: number; dir?: boolean }[] };
  usage?: {
    compute: { size: Size; seconds: number };
    model: { calls: number; input_tokens: number; cache_read_tokens: number; cache_write_tokens: number; output_tokens: number; web_searches: number };
  };
}
export interface RunRequest { version?: number; prompt: string; input?: string; webhook?: string; external_reference?: string }
export interface Model { provider: "openai" | "anthropic" | "xai"; model: string; reasoning_effort?: string; compact_at_tokens: number; max_output_tokens?: number }
export interface ProviderVersion { id: string; version: number; name: string; model: Model; created_at: string; created_by: string }
export interface Provider { id: string; name: string; latest: number; versions: ProviderVersion[] }
export interface LogEvent { at: string; kind: string; [field: string]: unknown }

/** The API's answer to a request it refused. */
export class JinnError extends Error {
  constructor(readonly status: number, message: string) { super(`jinn: ${status}: ${message}`); }
}

export class Jinn {
  readonly key: string;
  readonly baseURL: string;
  constructor(opts: { key: string; baseURL?: string }) {
    this.key = opts.key;
    this.baseURL = (opts.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.baseURL + path, {
      method,
      headers: { Authorization: `Bearer ${this.key}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).error ?? text; } catch { /* not JSON */ }
      throw new JinnError(res.status, msg);
    }
    return JSON.parse(text) as T;
  }

  async bases(): Promise<{ name: string; sha256: string; bytes: number }[]> {
    return (await this.call<{ bases: { name: string; sha256: string; bytes: number }[] }>("GET", "/v1/bases")).bases;
  }
  async functions(): Promise<FunctionSummary[]> {
    return (await this.call<{ functions: FunctionSummary[] }>("GET", "/v1/functions")).functions;
  }
  /** A function and its versions, oldest first. */
  function(id: string): Promise<{ function: FunctionHead; versions: Version[] }> {
    return this.call("GET", `/v1/functions/${encodeURIComponent(id)}`);
  }
  createFunction(name: string, def: Definition): Promise<Version> {
    return this.call("POST", "/v1/functions", { name, ...def });
  }
  publish(id: string, def: Definition): Promise<Version> {
    return this.call("POST", `/v1/functions/${encodeURIComponent(id)}/versions`, def);
  }

  /** Start a run; every call is a new run. */
  startRun(fn: string, req: RunRequest): Promise<Run> {
    return this.call("POST", `/v1/functions/${encodeURIComponent(fn)}/runs`, req);
  }
  run(id: string): Promise<Run> {
    return this.call("GET", `/v1/runs/${encodeURIComponent(id)}`);
  }
  /** Read the run every five seconds until it has its result. */
  async wait(id: string, signal?: AbortSignal): Promise<Run> {
    for (;;) {
      const r = await this.run(id);
      if (r.state === "succeeded" || r.state === "failed") return r;
      signal?.throwIfAborted();
      await new Promise((ok) => setTimeout(ok, 5000));
    }
  }
  /** Runs newest first, a page at a time. A run key must name a function. */
  runs(q: { function?: string; state?: "active" | "succeeded" | "failed"; before?: string } = {}): Promise<{ runs: Run[]; next?: string }> {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    return this.call("GET", `/v1/runs?${p}`);
  }
  /** The run's log so far. A running run adds to it about every 30 seconds. */
  async log(id: string): Promise<LogEvent[]> {
    const { parts } = await this.call<{ parts: string[] }>("GET", `/v1/runs/${encodeURIComponent(id)}/log`);
    const out: LogEvent[] = [];
    for (const url of parts) {
      const res = await fetch(url);
      if (!res.ok) throw new JinnError(res.status, "log part");
      for (const line of (await res.text()).split("\n")) if (line.trim()) out.push(JSON.parse(line));
    }
    return out;
  }

  /** Upload a run's input folder as one .tar.gz (see pack()); returns its file id. */
  async upload(data: Uint8Array): Promise<string> {
    const sum = await sha256(data);
    const f = await this.call<{ id: string; url: string; method: string; headers: Record<string, string> }>("POST", "/v1/files", { bytes: data.byteLength, sha256: sum });
    const res = await fetch(f.url, { method: f.method, headers: f.headers, body: data as BodyInit });
    if (!res.ok) throw new JinnError(res.status, "upload: " + (await res.text()).slice(0, 500));
    return f.id;
  }
  /** Download a succeeded run's output .tar.gz (see unpack()), checked against its SHA-256. */
  async output(r: Run): Promise<Uint8Array> {
    if (!r.output) throw new Error("jinn: the run has no output");
    const res = await fetch(r.output.url);
    if (!res.ok) throw new JinnError(res.status, "output");
    const data = new Uint8Array(await res.arrayBuffer());
    if ((await sha256(data)) !== r.output.sha256) throw new Error("jinn: the output does not match its SHA-256");
    return data;
  }

  async providers(): Promise<Provider[]> {
    return (await this.call<{ providers: Provider[] }>("GET", "/v1/providers")).providers;
  }
  createProvider(name: string, model: Model, key: string): Promise<ProviderVersion> {
    return this.call("POST", "/v1/providers", { name, model, key });
  }
  publishProvider(id: string, model: Model, key: string): Promise<ProviderVersion> {
    return this.call("POST", `/v1/providers/${encodeURIComponent(id)}/versions`, { model, key });
  }
}

async function sha256(data: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

const enc = new TextEncoder(), dec = new TextDecoder();

/** pack makes a .tar.gz of files ({ "path/in/folder": bytes or text }) for upload(). */
export async function pack(files: Record<string, Uint8Array | string>): Promise<Uint8Array> {
  return gzip(tarOf(files), new CompressionStream("gzip"));
}

/** unpack reads a run's output .tar.gz into { path: bytes } (files only). */
export async function unpack(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return untarOf(await gzip(data, new DecompressionStream("gzip")));
}

async function gzip(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function tarOf(files: Record<string, Uint8Array | string>): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const [name, content] of Object.entries(files)) {
    const body = typeof content === "string" ? enc.encode(content) : content;
    const h = new Uint8Array(512);
    const put = (s: string, at: number, len: number) => h.set(enc.encode(s).subarray(0, len), at);
    if (enc.encode(name).length > 100) throw new Error(`jinn: ${name}: names over 100 bytes are not supported`);
    put(name, 0, 100);
    put("0000644\0", 100, 8); put("0000000\0", 108, 8); put("0000000\0", 116, 8);
    put(body.byteLength.toString(8).padStart(11, "0") + "\0", 124, 12);
    put("00000000000\0", 136, 12);
    put("        ", 148, 8);
    put("0", 156, 1);
    put("ustar\0" + "00", 257, 8);
    const sum = h.reduce((a, b) => a + b, 0);
    put(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
    blocks.push(h, body, new Uint8Array((512 - (body.byteLength % 512)) % 512));
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.byteLength, 0));
  let at = 0;
  for (const b of blocks) { out.set(b, at); at += b.byteLength; }
  return out;
}

function untarOf(data: Uint8Array): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (let at = 0; at + 512 <= data.byteLength;) {
    const h = data.subarray(at, at + 512);
    if (h.every((b) => b === 0)) break;
    const str = (from: number, len: number) => dec.decode(h.subarray(from, from + len)).replace(/\0.*$/s, "");
    const prefix = str(345, 155);
    const name = (prefix ? prefix + "/" : "") + str(0, 100);
    const size = parseInt(str(124, 12).trim() || "0", 8);
    const type = str(156, 1) || "0";
    if (type === "0") files[name.replace(/^\.\//, "")] = data.slice(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** The body of a webhook: run.succeeded or run.failed, with the run. */
export interface WebhookEvent { id: string; type: "run.succeeded" | "run.failed"; created: string; data: Run }

/**
 * verifyWebhook checks a webhook (Standard Webhooks, v1a, Ed25519) with your
 * account's public key (whpk_…) and returns its event. It refuses one
 * signed more than five minutes from now.
 */
export async function verifyWebhook(publicKey: string, headers: Headers | Record<string, string>, body: string, now = Date.now()): Promise<WebhookEvent> {
  const get = (k: string) => headers instanceof Headers ? headers.get(k) ?? "" : headers[k] ?? headers[k.toLowerCase()] ?? "";
  const id = get("webhook-id"), ts = get("webhook-timestamp");
  if (!ts || Math.abs(now / 1000 - Number(ts)) > 300) throw new Error("jinn: the webhook's timestamp is missing or too far from now");
  const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", b64(publicKey.replace(/^whpk_/, "")), { name: "Ed25519" }, false, ["verify"]);
  const signed = enc.encode(`${id}.${ts}.${body}`);
  for (const part of get("webhook-signature").split(" ")) {
    const [v, sig] = part.split(",");
    if (v === "v1a" && sig && (await crypto.subtle.verify("Ed25519", key, b64(sig), signed))) return JSON.parse(body);
  }
  throw new Error("jinn: no signature matches");
}
