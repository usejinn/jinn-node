# Jinn for TypeScript

The TypeScript client for [Jinn](https://usejinn.com): run agent work as a call. A prompt and a folder in, a folder out.

It uses `fetch` and Web Crypto only. It runs in Node 20 and later, Deno, Bun and browsers, with no dependencies.

This repository is published from Jinn's own source. Open issues here; changes come in from there.

## Install

```sh
npm install @usejinn/sdk
```

Until the package is on npm, install it from this repository: `npm install github:usejinn/jinn-node`.

## Use

```ts
import { Jinn, tar, untar } from "@usejinn/sdk";

const jinn = new Jinn({ key: process.env.JINN_KEY! });
const input = await jinn.upload(tar({ "ticket.json": JSON.stringify(ticket) }));
let run = await jinn.startRun("fnc_5d2a91c07e4b38f6a1d0c2e9", { prompt: "Answer this ticket.", input });
run = await jinn.wait(run.id);
if (run.state === "succeeded") {
  const files = untar(await jinn.output(run));
  console.log(new TextDecoder().decode(files["reply.md"]));
} else {
  console.error(run.failure, run.detail);
}
```

`verifyWebhook` checks a webhook's signature.

Docs: [docs.usejinn.com](https://docs.usejinn.com) · API: [openapi.json](https://docs.usejinn.com/openapi.json) · Licence: MIT
