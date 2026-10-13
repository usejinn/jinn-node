# Jinn TypeScript SDK

The TypeScript client for the [Jinn](https://usejinn.com) API. A Jinn function says what a run is: the disk it boots, its setup, its size and, if you want one, an agent. A run with an agent takes a prompt and a folder and gives back the files you asked for. A run without one is a VM you drive with commands, and it can save its disk as an image for the next run.

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

## Drive a run yourself

A function without an agent is a VM you act on with commands. Commands run side by side; each waits for the VM's setup.

```ts
const run = await jinn.startRun("fnc_…", { image: "img_…" }); // boot an image a run saved
const res = await jinn.exec(run.id, { command: "npm test", workdir: "/workspace/app" });
console.log(res.exit_code, res.output);

await jinn.put(run.id, new TextEncoder().encode("{}"), "/workspace/app/fixture.json");
const { data } = await jinn.get(run.id, "/workspace/app/coverage"); // a folder comes as a .tar.gz

// Succeeded: /workspace/out is delivered and, if the function saves its
// disk, the run's output names the new image.
await jinn.finish(run.id, { state: "succeeded" });
```

`openTerminal(run, rows, cols)` starts a shell in a run and returns the relay's ticket and an end-to-end channel: connect a WebSocket to `` `${ticket.relay_url}?route=${ticket.route}&side=caller` `` and seal and open its frames with the channel (docs: Commands, Open a terminal).

`tools()` returns the standard tools' schemas, as Jinn's agent shows them to its model. A loop of your own can show its model the same tools and send each call as the command of the same kind.

## Get the result by webhook

Start the run with a `webhook` address. Jinn posts its events there: `run.running`, `run.maintenance`, `run.succeeded`, `run.failed` and `command.finished`. Check the signature with your account's public key (`whpk_…`, in the console):

```ts
import { verifyWebhook } from "@usejinn/sdk";

export async function POST(request: Request) {
  const body = await request.text();
  const event = await verifyWebhook(process.env.JINN_WEBHOOK_KEY!, request.headers, body); // throws if it does not match
  console.log(event.type, event.data.id); // run.succeeded run_… (command.finished: cmd_…)
  return new Response("ok");
}
```

## Reference

| Call | What it does |
|---|---|
| `startRun(fn, { prompt?, image?, environment?, input?, version?, webhook?, external_reference? })` | Start a run. Every call is a new run. |
| `run(id)` / `wait(id)` / `waitReady(id)` | Read a run; read it until it ends, or until its setup has finished. |
| `sendCommand(run, kind, args)` | Send a command: `bash`, `read`, `write`, `edit`, `list`, `put`, `get` or `finish`. |
| `command(run, id, wait?)` / `waitCommand(run, id)` | Read a command; read it until it ends. |
| `commands(run, since?, wait?)` | The run's commands that changed after a sequence. |
| `commandOutput(run, id, after?, wait?)` | What a bash command has written so far. |
| `cancelCommand(run, id)` | Cancel a command. |
| `exec`, `put`, `get`, `finish` | Send a command of that kind and wait for its result. |
| `images()`, `image(id)`, `deleteImage(id)` | The account's images and Jinn's bases. |
| `tools()` | The standard tools' schemas. |
| `runs({ function?, state?, before? })` | List runs, newest first, a page at a time. |
| `log(id)` | The run's log so far: setup, commands, the agent's messages and tool calls. |
| `upload(bytes)` / `pack(files)` | Upload a file, or an input folder as one `.tar.gz`. Returns a `file_…` id. |
| `output(run)` / `unpack(bytes)` | Download a succeeded run's output `.tar.gz` and read its files. |
| `functions()`, `function(id)`, `createFunction(name, def)`, `publish(id, def)` | Read and publish functions. Each publish is a new version. |
| `providers()`, `createProvider(…)`, `publishProvider(…)` | Manage model providers and their keys. |
| `verifyWebhook(publicKey, headers, body)` | Check a webhook and return its event. |

A refused request throws a `JinnError` with the HTTP `status`, a stable `code` and the API's message. Switch on `code`: for example `no_credit`, `suspended` or `not_found`. The [API docs](https://docs.usejinn.com/api#errors) list every code.

## Links

- [Docs](https://docs.usejinn.com): functions, runs, commands, images, webhooks and examples.
- [API](https://docs.usejinn.com/api) and [OpenAPI](https://docs.usejinn.com/openapi.json).
- Licence: MIT.

This repository is published from Jinn's main source. Open issues here.
