# Matchbox 🔥

Tiny, platform-neutral framework for independently registered capabilities, called **matches**.

> **No unrecorded success may be reported as a confirmed light.**

A **strike** is an attempt. A **light** is a recorded, verified success. A **dud** is execution failure. **Blocked** means execution was prevented. **Unstruck** means a call was expected but never dispatched. **Interrupted** means a strike began, but its terminal outcome is unknown.

## Install

Matchbox v0.2.0 is a *packaged release candidate*, not an npm-published release. The name `@matchbox-ai/core` is provisional until npm scope ownership is confirmed.

Install directly from GitHub (requires a Git client and Node 20+):

```sh
npm install github:emptychair1/Matchbox
```

Or clone the repository and run:

```sh
npm install
npm run check
npm pack --dry-run
```

## Example

```ts
import { createMatchbox, defineMatch } from "@matchbox-ai/core";

const clock = defineMatch({
  name: "clock",
  input: {
    parse(value: unknown) {
      if (typeof value !== "string") throw new TypeError("Expected timezone");
      return value;
    }
  },
  run: async (zone: string) => ({ zone, time: new Date().toISOString() }),
  verify: result => typeof result.time === "string"
});

// This is an example only. The host MUST implement these calls with
// genuine durable, atomic storage before using consequential matches.
const recorder = {
  async createPending() {
    throw new Error("Provide a durable recorder before enabling matches");
  },
  async settle() {
    throw new Error("Provide an atomic terminal recorder");
  }
};

const box = createMatchbox({
  matches: [clock],
  recorder,
  dependencies: {}
});

const result = await box.dispatch("clock", "UTC", { sessionId: "sample-session" });
console.log(result.outcome);
```

**This recorder deliberately fails closed.** Replace it with real durable and atomic storage before expecting a light. A promise that resolves without writing is a violation of the contract.

## Integration boundaries

Matchbox knows nothing about Cloudflare, Hono, DeepSeek, ElevenLabs, GitHub, Durable Objects, or R2. The host supplies dependencies and a **durable atomic recorder**. See [MATCH_SPEC_V02.md](MATCH_SPEC_V02.md) for execution/reconciliation semantics and [CONTRIBUTING.md](CONTRIBUTING.md) for contribution rules.

The host owns the reconciliation schedule. Call `reconcileExpired({ recorder, owner })` with the same durable recorder adapter. Matches must cooperate with abort signals; lease expiry is not process termination. The framework never retries uncertain external side effects.

## Status

v0.2.0 is a framework release candidate. It is not published to npm and has no Cloudflare durable-storage adapter yet. Do not treat contract-test success as proof that any particular external action occurred.
