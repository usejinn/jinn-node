import { test } from "node:test";
import assert from "node:assert/strict";
import { tar, untar, verifyWebhook } from "../dist/index.js";

test("tar and untar round-trip", () => {
  const files = untar(tar({ "a.txt": "hello", "deep/b.bin": new Uint8Array([1, 2, 3]) }));
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
