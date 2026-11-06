# handoff

A Pi Pocket drop-in module: `/handoff-now` has Pi write this session's handoff brief, and the session then starts a
fresh context that begins with it.

## Why

A long session carries decisions, dead ends, and rules that only exist in the messages. Pi's compaction handles the
size problem on its own. A handoff is a different thing: a person chooses the moment, and the model writes down what a
fresh session needs to continue without re-reading anything.

## What it does

The module adds one app command and one task. It adds no tool, no prompt section, and no hook, so nothing of it stands
in the model's context until you run the command. The system prompt and the history keep their exact bytes, and the
prompt cache keeps hitting.

`/handoff-now [extra requirements]` then:

1. Refuses with a toast if Pi is working on a round right now.
2. Starts a task in this conversation. The task submits one user message that asks for the brief, and waits for the
   answer. Anything you typed after the command is added to that request as a requirement.
3. Reads the answer, and appends a reset entry whose user message is the brief. The conversation's head moves to that
   entry, so the next request carries the brief and nothing before it.

The history stays on disk and in the transcript: the app draws a **New context** divider where the reset happened, with
the brief under it. Only the context the model sees starts over.

That one reset is the only cache miss, and any handoff pays it: the new context has to begin somewhere.

## What it does not do

- It does not write the brief itself. The brief comes from the model, word for word.
- It does not reset when something looks wrong. If Pi does not answer, or the brief is shorter than 200 or longer than
  20000 characters, the module shows a warning and leaves the session as it was.
- It does not hide the request it sends. That message shows in the transcript as one of your messages, above the
  divider.
- It does not compact, trim, or fold part of the history. It starts a new context or does nothing.
- It does not trigger by itself. There is no threshold and no timer.

## Install

1. Copy `handoff.ts` into the drop-in folder, `~/.pi-pocket/extensions/`.
2. Open Menu → Extensions, and turn on **handoff**.

It starts off, as every drop-in does. It runs inside the server with the owner's rights, so read the file first: it
imports `@earendil-works/pi-durable` and Pi Pocket's types only, reads no files, uses no network, and starts no
process.

## Use

```
/handoff-now
/handoff-now keep the open questions and anything still unfinished
```

Then ask what the session remembers: the answer comes from the brief alone.

## Typecheck

```sh
npm run typecheck
```

The module imports `@earendil-works/pi-durable` and `./_pocket.d.ts`. Pi Pocket links both into the drop-in folder at
each start. To typecheck this folder on its own, link them here from a Pi Pocket install:

```sh
ln -s /path/to/pi-pocket/node_modules node_modules
ln -s /path/to/pi-pocket/types/pocket.d.ts _pocket.d.ts
```

## License

MIT.
