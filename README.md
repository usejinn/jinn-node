# Jinn TypeScript SDK

The TypeScript client for the [Jinn](https://usejinn.com) API. Jinn runs agent work as a call: you send a prompt and a folder, and you get back the files you asked for.

It uses `fetch` and Web Crypto only. It runs in Node 20 and later, Deno, Bun and browsers, and has no dependencies. The command-line tool is [jinn-cli](https://github.com/usejinn/jinn-cli).

## Install

```sh
npm install github:usejinn/jinn-node
```

The package will also be on npm as `@usejinn/sdk`. Either way, you import it as `@usejinn/sdk`.

## Authenticate

An account owner makes an API key at [app.usejinn.com](https://app.usejinn.com) under **Account**:

```ts
import { Jinn } from "@usejinn/sdk";

const jinn = new Jinn({ key: process.env.JINN_KEY! });
```

## Run a function

```ts
import { Jinn, pack, unpack } from "@usejinn/sdk";

// Pack the input folder as a .tar.gz. It arrives in the run as /workspace/in.
const input = await jinn.upload(await pack({ "ticket.json": JSON.stringify(ticket) }));

let run = await jinn.startRun("fnc_5d2a91c07e4b38f6a1d0c2e9", {
  prompt: "Answer this ticket.",
  input,
  external_reference: "ticket-4812",
});

run = await jinn.wait(run.id); // reads the run every 5 seconds

if (run.state === "succeeded") {
  const files = await unpack(await jinn.output(run)); // checks the SHA-256
  console.log(new TextDecoder().decode(files["reply.md"]));
} else {
  console.error(run.failure, run.detail);
}
```

## Get the result by webhook

Start the run with a `webhook` address. Jinn posts the run there when it ends. Check the signature with your account's public key (`whpk_…`, in the console):

```ts
import { verifyWebhook } from "@usejinn/sdk";

export async function POST(request: Request) {
  const body = await request.text();
  const event = await verifyWebhook(process.env.JINN_WEBHOOK_KEY!, request.headers, body); // throws if it does not match
  console.log(event.type, event.data.id); // run.succeeded run_…
  return new Response("ok");
}
```

## Reference

| Call | What it does |
|---|---|
| `startRun(fn, { prompt, input?, version?, webhook?, external_reference? })` | Start a run. Every call is a new run. |
| `run(id)` / `wait(id)` | Read a run, or read it until it ends. |
| `runs({ function?, state?, before? })` | List runs, newest first, a page at a time. |
| `log(id)` | The run's log so far: setup output, the agent's messages and tool calls. |
| `upload(bytes)` / `pack(files)` | Upload an input folder as one `.tar.gz`. Returns a `file_…` id. |
| `output(run)` / `unpack(bytes)` | Download a succeeded run's output `.tar.gz` and read its files. |
| `functions()`, `function(id)`, `createFunction(name, def)`, `publish(id, def)` | Read and publish functions. Each publish is a new version. |
| `providers()`, `createProvider(…)`, `publishProvider(…)` | Manage model providers and their keys. |
| `bases()` | List the bases a function can boot. |
| `verifyWebhook(publicKey, headers, body)` | Check a webhook and return its event. |

A refused request throws a `JinnError` with the HTTP `status`, a stable `code` and the API's message. Switch on `code`: for example `no_credit`, `suspended` or `not_found`. The [API docs](https://docs.usejinn.com/api#errors) list every code.

## Links

- [Docs](https://docs.usejinn.com): functions, runs, webhooks and examples.
- [API](https://docs.usejinn.com/api) and [OpenAPI](https://docs.usejinn.com/openapi.json).
- Licence: MIT.

This repository is published from Jinn's main source. Open issues here.
