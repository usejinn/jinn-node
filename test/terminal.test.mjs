// The SDK's terminal channel against the service's test vector
// (service/terminal_test.go).
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { terminalChannel, TERMINAL_INPUT, TERMINAL_OUTPUT } from "../dist/index.js";

const callerKey = "BGOmXGIuNXXScxSZ6XmQkimNWV0Eln18A6TCJeH-uKAQCGmgfusQCN41WuAADoO2Ma_6IiPOfnPLcU_Y213fpIU";
const hostKey = "BJTKikBVEn7T_SwODdeALVNWEgGzMxILOgq2z3pDgdNJMWih1H7JRArE8C_I6ZCrTERJU0xfwZCM3xm93jJRmgQ";
const b64url = (b) => Buffer.from(b).toString("base64url");

async function pair(name, pub) {
  const raw = Buffer.from(pub, "base64url"), d = createHash("sha256").update(name).digest();
  const jwk = { kty: "EC", crv: "P-256", d: b64url(d), x: b64url(raw.subarray(1, 33)), y: b64url(raw.subarray(33)) };
  return { privateKey: await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]),
    publicKey: await crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, true, []) };
}

test("the terminal channel matches the service's vector", async () => {
  const caller = await terminalChannel(await pair("caller", callerKey), hostKey, true);
  const host = await terminalChannel(await pair("host", hostKey), callerKey, false);
  const input = await caller.seal(TERMINAL_INPUT, new TextEncoder().encode("ls\n"));
  assert.equal(Buffer.from(input).toString("hex"), "01000000000000000070090067983f4a37a088b3e5d2701a50deb9dd");
  const output = await host.seal(TERMINAL_OUTPUT, new TextEncoder().encode("hi"));
  assert.equal(Buffer.from(output).toString("hex"), "020000000000000000ed87304281a05e0b1784e209e91cb1227edf");
  assert.equal(new TextDecoder().decode((await host.open(input)).data), "ls\n");
  await assert.rejects(host.open(input));
  assert.equal(new TextDecoder().decode((await caller.open(output)).data), "hi");
});
