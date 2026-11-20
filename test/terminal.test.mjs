import test from "node:test";
import assert from "node:assert/strict";
import {
  TERMINAL_INPUT,
  TERMINAL_OUTPUT,
  TERMINAL_RESIZE,
  decodeTerminalFrame,
  encodeResizeFrame,
  encodeTerminalFrame,
  terminalURL,
} from "../dist/index.js";

test("terminal frame encode/decode and resize round-trip", () => {
  const input = encodeTerminalFrame(TERMINAL_INPUT, new TextEncoder().encode("ls\n"));
  const decoded = decodeTerminalFrame(input);
  assert.equal(decoded.kind, TERMINAL_INPUT);
  assert.equal(new TextDecoder().decode(decoded.data), "ls\n");

  const resize = encodeResizeFrame(40, 120);
  const rdec = decodeTerminalFrame(resize);
  assert.equal(rdec.kind, TERMINAL_RESIZE);
  const view = new DataView(rdec.data.buffer, rdec.data.byteOffset, rdec.data.byteLength);
  assert.equal(view.getUint16(0), 40);
  assert.equal(view.getUint16(2), 120);

  const out = encodeTerminalFrame(TERMINAL_OUTPUT, new TextEncoder().encode("hi"));
  assert.equal(new TextDecoder().decode(decodeTerminalFrame(out).data), "hi");
  assert.throws(() => decodeTerminalFrame(new Uint8Array()));
});

test("terminalURL encodes ticket and dimensions", () => {
  const url = terminalURL({ ticket: "tkt_abc", relay_url: "wss://ssh.usejinn.com/terminal" }, 24, 80);
  assert.equal(url, "wss://ssh.usejinn.com/terminal?ticket=tkt_abc&rows=24&cols=80");
});
