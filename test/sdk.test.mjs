import { test } from "node:test";
import assert from "node:assert/strict";
import { pack, unpack, verifyWebhook } from "../dist/index.js";
import { gunzipSync } from "node:zlib";

test("pack and unpack round-trip through a real .tar.gz", async () => {
  const packed = await pack({ "a.txt": "hello", "deep/b.bin": new Uint8Array([1, 2, 3]) });
  assert.equal(gunzipSync(packed).subarray(257, 262).toString(), "ustar");
  const files = await unpack(packed);
  assert.equal(new TextDecoder().decode(files["a.txt"]), "hello");
  assert.deepEqual([...files["deep/b.bin"]], [1, 2, 3]);
});

test("verifyWebhook accepts its key's signature and refuses another's", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const pub = "whpk_" + btoa(String.fromCharCode(...raw));
  const body = JSON.stringify({ id: "evt_1", type: "run.succeeded", created: "2026-10-06T00:00:00Z", data: { id: "run_1" } });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, new TextEncoder().encode(`evt_1.${ts}.${body}`)));
  const headers = { "webhook-id": "evt_1", "webhook-timestamp": ts, "webhook-signature": "v1a," + btoa(String.fromCharCode(...sig)) };
  assert.equal((await verifyWebhook(pub, headers, body)).data.id, "run_1");
  await assert.rejects(verifyWebhook(pub, headers, body.replace("run_1", "run_2")));
});

test("exec sends a bash command and long-polls its result", async () => {
  const { Jinn } = await import("../dist/index.js");
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (init.method === "POST" && u.pathname === "/v1/runs/run_1/commands") {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: "cmd_1", state: "queued" }));
    }
    if (u.pathname === "/v1/runs/run_1/commands/cmd_1" && u.searchParams.get("wait") === "25") {
      return new Response(JSON.stringify({ id: "cmd_1", state: "succeeded", result: { exit_code: 0, output: "ok", output_bytes: 2 } }));
    }
    return new Response(JSON.stringify({ code: "not_found", error: "no" }), { status: 404 });
  };
  try {
    const jinn = new Jinn({ key: "k", baseURL: "https://api.test" });
    const res = await jinn.exec("run_1", { command: "make", env: { CI: "1" } });
    assert.equal(res.output, "ok");
    assert.deepEqual(sent[0], { kind: "bash", arguments: { command: "make", env: { CI: "1" } } });
    await assert.rejects(jinn.run("run_x"), (e) => e.code === "not_found");
  } finally {
    globalThis.fetch = real;
  }
});

test("startRun sends idempotency_key as the Idempotency-Key header, not in the body", async () => {
  const { Jinn } = await import("../dist/index.js");
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ key: init.headers["Idempotency-Key"], body: init.body });
    return new Response(JSON.stringify({ id: "run_1", state: "queued" }), { status: 201 });
  };
  try {
    const jinn = new Jinn({ key: "jinn_test", baseURL: "https://api.test" });
    await jinn.startRun("fnc_1", { prompt: "x", idempotency_key: "evt_1" });
    await jinn.startRun("fnc_1", { prompt: "x" });
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(seen[0].key, "evt_1");
  assert.deepEqual(JSON.parse(seen[0].body), { prompt: "x" });
  assert.equal(seen[1].key, undefined);
});

test("logSince reads each part once, eight at a time, wherever a new part is listed", async () => {
  const { Jinn } = await import("../dist/index.js");
  const real = globalThis.fetch;
  let listed = ["0001-host", "0003-agent"], open = 0, most = 0;
  const reads = {};
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname === "/v1/runs/run_1/log") {
      return new Response(JSON.stringify({ parts: listed.map((p) => `https://s3.test/log/${p}.ndjson?X-Amz-Signature=${Math.random()}`) }));
    }
    const name = u.pathname.replace(/^\/log\/|\.ndjson$/g, "");
    reads[name] = (reads[name] || 0) + 1;
    most = Math.max(most, ++open);
    await new Promise((r) => setTimeout(r, 5));
    open--;
    return new Response(JSON.stringify({ at: "2026-10-26T13:00:0" + name.slice(3, 4) + "Z", kind: name }) + "\n");
  };
  try {
    const jinn = new Jinn({ key: "k", baseURL: "https://api.test" });
    const read = new Set();
    assert.deepEqual((await jinn.logSince("run_1", read)).map((e) => e.kind), ["0001-host", "0003-agent"]);
    listed = ["0001-host", "0002-host", "0003-agent", "0004-agent"];
    assert.deepEqual((await jinn.logSince("run_1", read)).map((e) => e.kind), ["0002-host", "0004-agent"]);
    assert.ok(Object.values(reads).every((n) => n === 1), JSON.stringify(reads));
    listed = Array.from({ length: 40 }, (_, i) => String(1000 + i).padStart(4, "0") + "-agent");
    await jinn.log("run_1");
    assert.equal(most, 8);
  } finally {
    globalThis.fetch = real;
  }
});
