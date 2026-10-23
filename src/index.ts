// @usejinn/sdk: the TypeScript client for Jinn's API (https://api.usejinn.com/v1).
// It uses fetch and Web Crypto only, so it runs in Node 20+, Deno, Bun and browsers.
//
// A function with an agent takes a prompt and returns a folder:
//
//   const jinn = new Jinn({ key: process.env.JINN_KEY! });
//   const input = await jinn.upload(await pack({ "ticket.json": JSON.stringify(ticket) }));
//   let run = await jinn.startRun("fnc_…", { prompt: "Answer this ticket.", input });
//   run = await jinn.wait(run.id);
//   const files = await unpack(await jinn.output(run)); // { "reply.md": Uint8Array, … }
//
// A function without one is a VM you drive with commands:
//
//   const run = await jinn.startRun("fnc_…", {});
//   const res = await jinn.exec(run.id, { command: "npm test" });
//   await jinn.finish(run.id, { state: "succeeded" });

export const DEFAULT_BASE_URL = "https://api.usejinn.com";

/** max_bytes left out is the limit. */
export interface ManifestEntry { path: string; description?: string; max_bytes?: number }
export interface CustomTool {
  name: string; description: string; parameters: Record<string, unknown>; url: string;
  /** Sent once; later versions send the secret_id Jinn returned. */
  secret?: string; secret_id?: string; /** 30 if left out. */ timeout_seconds?: number;
}
export interface EnvVar { name: string; value?: string; secret?: string; secret_id?: string }
export type Size = "s" | "m" | "l" | "xl";
export type StandardTool = "bash" | "read" | "write" | "edit" | "screenshot" | "web_search";
/** Jinn's agent: a model with tools, working until it calls complete (the run succeeds) or give_up (it fails). */
export interface Agent {
  /** openai (its latest version), openai@3, prv_…@3 or prv_…@latest. Publishing stores a name as the id. Left out: the account's only provider. */
  provider?: string;
  system_prompt: string;
  /** Left out: all of them. [] is none. complete and give_up are always there. */
  tools?: StandardTool[];
  custom_tools?: CustomTool[];
}
/**
 * A function's definition. Every field is optional; publishing fills in what
 * is left out, and the version stores it: image the newest base, size "m",
 * lists empty, no timeout. A definition with an agent is agentic: its runs
 * take a prompt.
 */
export interface Definition {
  /** The disk a run boots: an img_… or a base's name (images()). */
  image?: string;
  /** Run as root at the start of every run, each in bash -euo pipefail -c. They must be safe to repeat. */
  setup?: string[];
  environment?: EnvVar[];
  size?: Size;
  /** 1 to 1440, setup included. Left out: none. */
  timeout_minutes?: number;
  input_manifest?: ManifestEntry[];
  /** What /workspace/out must hold when the run finishes succeeded. */
  output_manifest?: ManifestEntry[];
  /** Save the run's disk as an image when it succeeds, and when Jinn stops it. */
  output_image?: boolean;
  agent?: Agent;
}
/** A published version: every default filled in. */
export interface Version extends Definition {
  image: string; size: Size;
  function: string; version: number; external_reference?: string; created_at: string; created_by: string;
}
export interface FunctionHead { id: string; name: string; latest: number; updated_at: string }
export interface FunctionSummary extends FunctionHead { definition: Version; last: Run | null }

export type Failure = "input" | "incomplete" | "timeout" | "provider" | "infrastructure" | "setup" | "suspended" | "credit" | "maintenance";
export interface Run {
  id: string; account: string; function: string; version: number;
  /** The disk the run booted. */
  image: string; size: Size; agent: boolean; provider?: string;
  prompt?: string; input?: string; webhook?: string; external_reference?: string;
  state: "queued" | "running" | "succeeded" | "failed";
  created_at: string; created_by: string; started_at?: string; ready_at?: string; ended_at?: string;
  failure?: Failure; detail?: string; message?: string;
  /** What the run returned: its output folder as one .tar.gz (url works for 15 minutes), and the image it saved. */
  output?: { sha256?: string; bytes?: number; file_count?: number; url?: string; files?: { path: string; bytes: number; dir?: boolean }[]; image?: string };
  usage?: {
    compute: { size: Size; seconds: number; bytes_in: number; bytes_out: number };
    model: { calls: number; input_tokens: number; cache_read_tokens: number; cache_write_tokens: number; output_tokens: number; web_searches: number };
  };
  /** Counts the run's changes, its commands' included. */
  sequence: number;
  /** When Jinn will end the run to replace its host. */
  maintenance_at?: string;
}
export interface RunRequest {
  version?: number;
  /** Required for a function with an agent; refused for one without. */
  prompt?: string;
  /** The disk to boot instead of the function's. */
  image?: string;
  /** Added to the function's variables; a name the function has takes this value. */
  environment?: EnvVar[];
  input?: string; webhook?: string; external_reference?: string;
  /** Sent as the Idempotency-Key header, not in the body: a start of the same function with the same key in the last 24 hours returns that run instead of a new one. */
  idempotency_key?: string;
}
export interface Model { provider: "openai" | "anthropic" | "xai"; model: string; reasoning_effort?: string; compact_at_tokens: number; max_output_tokens?: number }
export interface ProviderVersion { id: string; version: number; name: string; model: Model; created_at: string; created_by: string }
export interface Provider { id: string; name: string; latest: number; versions: ProviderVersion[] }
export interface LogEvent { at: string; kind: string; [field: string]: unknown }

export type CommandKind = "bash" | "read" | "write" | "edit" | "list" | "put" | "get" | "finish" | "terminal";
export interface BashArgs { command: string; workdir?: string; timeout_ms?: number; env?: Record<string, string> }
export interface BashResult { exit_code: number; output: string; output_bytes: number; truncated?: boolean; timed_out?: boolean; oom_killed?: boolean; error?: string }
export interface FinishArgs { state: "succeeded" | "failed"; detail?: string }
export interface FinishResult { accepted: boolean; problems?: string[] }
export interface Command {
  id: string; run: string; kind: CommandKind; arguments: Record<string, unknown>;
  /** caller, or agent for Jinn's agent's commands. */
  source: "caller" | "agent"; call_id?: string;
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  result?: Record<string, unknown>; error?: string;
  output_bytes: number; sequence: number;
  created_at: string; created_by: string; started_at?: string; ended_at?: string;
  /** What a get delivered; the image a read showed. Links work for 15 minutes. */
  download_url?: string; image_url?: string;
}
export interface Image {
  id: string; base?: boolean; run?: string; function?: string; external_reference?: string;
  sha256: string; bytes: number; disk_bytes: number; created_at: string;
}
export interface Tool { name: string; description: string; parameters: Record<string, unknown> }

/** The API's answer to a request it refused. `code` is stable (no_credit, suspended, not_found, …); the message is for people. */
export class JinnError extends Error {
  constructor(readonly status: number, message: string, readonly code = "") { super(`jinn: ${status} ${code}: ${message}`); }
}

export class Jinn {
  readonly key: string;
  readonly baseURL: string;
  constructor(opts: { key: string; baseURL?: string }) {
    this.key = opts.key;
    this.baseURL = (opts.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  private async call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const res = await fetch(this.baseURL + path, {
      method,
      headers: { Authorization: `Bearer ${this.key}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text, code = "";
      try { const e = JSON.parse(text); msg = e.error ?? text; code = e.code ?? ""; } catch { /* not JSON */ }
      throw new JinnError(res.status, msg, code);
    }
    return JSON.parse(text) as T;
  }

  /** The account's images, newest first, then Jinn's bases. */
  async images(): Promise<Image[]> {
    return (await this.call<{ images: Image[] }>("GET", "/v1/images")).images;
  }
  image(id: string): Promise<Image> {
    return this.call("GET", `/v1/images/${encodeURIComponent(id)}`);
  }
  /** Delete one of the account's images. Runs that would boot it fail with image_not_found. */
  async deleteImage(id: string): Promise<void> {
    await this.call("DELETE", `/v1/images/${encodeURIComponent(id)}`);
  }
  /** The standard tools' schemas, as Jinn's agent shows them to its model. */
  async tools(): Promise<Tool[]> {
    return (await this.call<{ tools: Tool[] }>("GET", "/v1/tools")).tools;
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
  /** Delete a function, its versions and their secrets. Its runs and their images stay. While a run of it is queued or running, the API refuses with runs_active. */
  async deleteFunction(id: string): Promise<void> {
    await this.call("DELETE", `/v1/functions/${encodeURIComponent(id)}`);
  }

  /** Start a run. Each call is a new run, unless it repeats an idempotency_key. */
  startRun(fn: string, req: RunRequest): Promise<Run> {
    const { idempotency_key, ...body } = req;
    return this.call("POST", `/v1/functions/${encodeURIComponent(fn)}/runs`, body,
      idempotency_key === undefined ? {} : { "Idempotency-Key": idempotency_key });
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
  /** Read the run every two seconds until its setup has finished, or it ended. */
  async waitReady(id: string, signal?: AbortSignal): Promise<Run> {
    for (;;) {
      const r = await this.run(id);
      if (r.ready_at || r.state === "succeeded" || r.state === "failed") return r;
      signal?.throwIfAborted();
      await new Promise((ok) => setTimeout(ok, 2000));
    }
  }

  /** Send a command. Commands run side by side; one sent while the run is queued starts when its setup has finished. */
  sendCommand(run: string, kind: CommandKind, args: Record<string, unknown>): Promise<Command> {
    return this.call("POST", `/v1/runs/${encodeURIComponent(run)}/commands`, { kind, arguments: args });
  }
  /** Read a command, waiting up to waitSeconds (at most 25) for it to end. */
  command(run: string, id: string, waitSeconds = 0): Promise<Command> {
    const w = waitSeconds > 0 ? `?wait=${Math.min(25, Math.floor(waitSeconds))}` : "";
    return this.call("GET", `/v1/runs/${encodeURIComponent(run)}/commands/${encodeURIComponent(id)}${w}`);
  }
  /** Read a command until it ends. */
  async waitCommand(run: string, id: string, signal?: AbortSignal): Promise<Command> {
    for (;;) {
      const c = await this.command(run, id, 25);
      if (c.state === "succeeded" || c.state === "failed" || c.state === "cancelled") return c;
      signal?.throwIfAborted();
    }
  }
  /** The run's commands that changed after a sequence, in order, about 4 MiB at most, and the sequence to send as the next since. */
  commands(run: string, since = 0, waitSeconds = 0): Promise<{ state: Run["state"]; sequence: number; commands: Command[] }> {
    const p = new URLSearchParams({ since: String(since) });
    if (waitSeconds > 0) p.set("wait", String(Math.min(25, Math.floor(waitSeconds))));
    return this.call("GET", `/v1/runs/${encodeURIComponent(run)}/commands?${p}`);
  }
  /** What a bash command wrote from an offset on, 512 KiB at most; next is where to read next, and done says this is the last. */
  commandOutput(run: string, id: string, after = 0, waitSeconds = 0): Promise<{ output: string; next: number; output_bytes: number; stored_bytes: number; done: boolean }> {
    const p = new URLSearchParams({ after: String(after) });
    if (waitSeconds > 0) p.set("wait", String(Math.min(25, Math.floor(waitSeconds))));
    return this.call("GET", `/v1/runs/${encodeURIComponent(run)}/commands/${encodeURIComponent(id)}/output?${p}`);
  }
  cancelCommand(run: string, id: string): Promise<Command> {
    return this.call("POST", `/v1/runs/${encodeURIComponent(run)}/commands/${encodeURIComponent(id)}/cancel`);
  }
  /** Run a bash command and wait for its result. */
  async exec(run: string, args: BashArgs): Promise<BashResult> {
    const c = await this.waitCommand(run, (await this.sendCommand(run, "bash", { ...args })).id);
    if (c.state !== "succeeded") throw new Error(`jinn: the command ${c.state}: ${c.error ?? ""}`);
    return c.result as unknown as BashResult;
  }
  /** Copy bytes into a run at path. */
  async put(run: string, data: Uint8Array, path: string): Promise<void> {
    const file = await this.upload(data);
    const c = await this.waitCommand(run, (await this.sendCommand(run, "put", { file, path })).id);
    const err = c.state !== "succeeded" ? `the command ${c.state}: ${c.error ?? ""}` : (c.result?.error as string | undefined);
    if (err) throw new Error("jinn: " + err);
  }
  /** Copy a file, or a folder as a .tar.gz (see unpack()), out of a run. */
  async get(run: string, path: string): Promise<{ data: Uint8Array; folder: boolean }> {
    const c = await this.waitCommand(run, (await this.sendCommand(run, "get", { path })).id);
    const err = c.state !== "succeeded" ? `the command ${c.state}: ${c.error ?? ""}` : (c.result?.error as string | undefined);
    if (err) throw new Error("jinn: " + err);
    const folder = c.result?.folder === true;
    if (!c.download_url) return { data: new Uint8Array(), folder };
    const res = await fetch(c.download_url);
    if (!res.ok) throw new JinnError(res.status, "get");
    return { data: new Uint8Array(await res.arrayBuffer()), folder };
  }
  /** End a run: succeeded (its output checked and delivered), or failed with a detail. An output that misses its manifest is not accepted, and the run goes on. */
  async finish(run: string, args: FinishArgs): Promise<FinishResult> {
    const c = await this.waitCommand(run, (await this.sendCommand(run, "finish", { ...args })).id);
    if (c.state !== "succeeded") throw new Error(`jinn: the finish ${c.state}: ${c.error ?? ""}`);
    return c.result as unknown as FinishResult;
  }
  /**
   * Start a shell in a run: a login shell as root in /workspace, reached through Jinn's relay and sealed end to end.
   * Connect a WebSocket to `${ticket.relay_url}?route=${ticket.route}&side=caller` (binaryType "arraybuffer"), send
   * `channel.seal(TERMINAL_INPUT, bytes)` and `channel.seal(TERMINAL_RESIZE, rowsCols)`, and `channel.open` each message:
   * TERMINAL_OUTPUT is what the shell wrote, TERMINAL_EXIT its status (an int32).
   */
  async openTerminal(run: string, rows: number, cols: number, env?: Record<string, string>): Promise<{ ticket: TerminalTicket; channel: TerminalChannel }> {
    const pair = await terminalKeyPair();
    const args: Record<string, unknown> = { rows, cols, public_key: await terminalPublicKey(pair) };
    if (env) args.env = env;
    const c = await this.waitCommand(run, (await this.sendCommand(run, "terminal", args)).id);
    if (c.state !== "succeeded") throw new Error(`jinn: the terminal ${c.state}: ${c.error ?? ""}`);
    const ticket = c.result as unknown as TerminalTicket;
    return { ticket, channel: await terminalChannel(pair, ticket.public_key, true) };
  }
  /** Runs newest first, a page at a time. A run key must name a function. */
  runs(q: { function?: string; state?: "active" | "succeeded" | "failed"; before?: string } = {}): Promise<{ runs: Run[]; next?: string }> {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    return this.call("GET", `/v1/runs?${p}`);
  }
  /** The run's log so far, in time order. A running run adds to it about every 30 seconds. */
  async log(id: string): Promise<LogEvent[]> {
    const { parts } = await this.call<{ parts: string[] }>("GET", `/v1/runs/${encodeURIComponent(id)}/log`);
    const out: LogEvent[] = [];
    for (const url of parts) {
      const res = await fetch(url);
      if (!res.ok) throw new JinnError(res.status, "log part");
      for (const line of (await res.text()).split("\n")) if (line.trim()) out.push(JSON.parse(line));
    }
    return out.sort((a, b) => a.at.localeCompare(b.at));
  }

  /** Upload a run's input folder as one .tar.gz (see pack()), or a file for put(); returns its file id. */
  async upload(data: Uint8Array): Promise<string> {
    const sum = await sha256(data);
    const f = await this.call<{ id: string; url: string; method: string; headers: Record<string, string> }>("POST", "/v1/files", { bytes: data.byteLength, sha256: sum });
    const res = await fetch(f.url, { method: f.method, headers: f.headers, body: data as BodyInit });
    if (!res.ok) throw new JinnError(res.status, "upload: " + (await res.text()).slice(0, 500));
    return f.id;
  }
  /** Download a succeeded run's output .tar.gz (see unpack()), checked against its SHA-256. */
  async output(r: Run): Promise<Uint8Array> {
    if (!r.output?.url) throw new Error("jinn: the run has no output");
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
  /** Delete a provider, its versions and their keys. While the latest version of a function names it, the API refuses with provider_in_use; while a run that uses it is queued or running, with runs_active. */
  async deleteProvider(id: string): Promise<void> {
    await this.call("DELETE", `/v1/providers/${encodeURIComponent(id)}`);
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

/** The body of a webhook: a run's event with the run, or command.finished with the command. sequence is the run's. */
export type WebhookEvent =
  | { id: string; type: "run.running" | "run.maintenance" | "run.succeeded" | "run.failed"; created: string; sequence: number; data: Run }
  | { id: string; type: "command.finished"; created: string; sequence: number; data: Command };

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

// ── Terminals ──
// The caller's half of a terminal's channel, as Jinn's service seals it: an ECDH P-256 key pair, two AES-256-GCM
// keys (one per direction) derived with HKDF-SHA-256, and frames of a kind (one byte), a sequence (eight bytes) and
// the sealed data. A test vector keeps it equal to the service's.

/** Terminal frame kinds. */
export const TERMINAL_INPUT = 1, TERMINAL_OUTPUT = 2, TERMINAL_RESIZE = 3, TERMINAL_EXIT = 4;

/** A terminal command's result: where to connect, and the host's half of the key. */
export interface TerminalTicket { relay_url: string; route: string; public_key: string }

/** Seals and opens one end's frames, in order. */
export interface TerminalChannel {
  seal(kind: number, data: Uint8Array): Promise<Uint8Array>;
  open(frame: ArrayBuffer | Uint8Array): Promise<{ kind: number; data: Uint8Array }>;
}

const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const join = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
const nonceOf = (seq: bigint) => { const n = new Uint8Array(12); new DataView(n.buffer).setBigUint64(4, seq); return n; };

/** A key pair for one end of a terminal. */
export function terminalKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as Promise<CryptoKeyPair>;
}

/** A key pair's public key, uncompressed, base64url. */
export async function terminalPublicKey(pair: CryptoKeyPair): Promise<string> {
  return b64url(await crypto.subtle.exportKey("raw", pair.publicKey));
}

/** One end's channel, from its key pair and the other end's public key. */
export async function terminalChannel(pair: CryptoKeyPair, peer: string, caller: boolean): Promise<TerminalChannel> {
  const subtle = crypto.subtle, enc = new TextEncoder(), peerRaw = unb64url(peer);
  const peerKey = await subtle.importKey("raw", peerRaw as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = await subtle.deriveBits({ name: "ECDH", public: peerKey }, pair.privateKey, 256);
  const mine = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  const salt = await subtle.digest("SHA-256", join(enc.encode("jinn-terminal-v1\0"), caller ? mine : peerRaw, caller ? peerRaw : mine) as BufferSource);
  const ikm = await subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
  const keys = new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode("jinn-terminal-v1 keys") }, ikm, 512));
  const aes = (raw: Uint8Array) => subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
  const toHost = await aes(keys.slice(0, 32)), toCaller = await aes(keys.slice(32));
  const send = caller ? toHost : toCaller, recv = caller ? toCaller : toHost;
  let sendSeq = 0n, recvSeq = 0n, sealing: Promise<unknown> = Promise.resolve(), opening: Promise<unknown> = Promise.resolve();
  return {
    seal(kind, data) {
      const run = sealing.then(async () => {
        const head = new Uint8Array(9);
        head[0] = kind;
        new DataView(head.buffer).setBigUint64(1, sendSeq);
        const sealed = await subtle.encrypt({ name: "AES-GCM", iv: nonceOf(sendSeq), additionalData: head }, send, data as BufferSource);
        sendSeq++;
        return join(head, new Uint8Array(sealed));
      });
      sealing = run.catch(() => undefined);
      return run;
    },
    open(frame) {
      const run = opening.then(async () => {
        const f = new Uint8Array(frame);
        if (f.length < 25) throw new Error("jinn: a terminal frame of the wrong size");
        if (new DataView(f.buffer, f.byteOffset).getBigUint64(1) !== recvSeq) throw new Error("jinn: a terminal frame out of order");
        const data = await subtle.decrypt({ name: "AES-GCM", iv: nonceOf(recvSeq), additionalData: f.slice(0, 9) as BufferSource }, recv, f.slice(9) as BufferSource);
        recvSeq++;
        return { kind: f[0], data: new Uint8Array(data) };
      });
      opening = run.catch(() => undefined);
      return run;
    },
  };
}
