# Matchbox v0.2 contract (bite 1 of 4)

> **No unrecorded success may be reported as a confirmed light.**
>
> **Interrupted means the outcome is unknown, not that the operation failed.**

This document defines the target contract. The current v0.1 JavaScript dispatcher has **not** yet been replaced; dispatch, durable recording, and reconciliation are subsequent bites.

A **match** is a small capability, defined with `defineMatch(spec)`. Definition never invokes `run`.

## Types

`MatchSpec<Input, Value, Dependencies>` declares a unique `name`, input schema with `parse(unknown): Input`, `run(input, context)`, mandatory `verify(value, input, context)`, optional redacted input summary, and optional timeout. `MatchContext` supplies session ID, injected dependencies, and abort signal.

`MatchExecutionOutcome` is a discriminated union: `light(value)`, `dud(error)`, or `blocked(reason)`. A call that never happened cannot be returned by dispatch. `MatchObservation` additionally includes `unstruck` and `interrupted`, which are determined through reconciliation and expectation reporting.

**Contract verification** checks conformance to the interface and failure handling. **Runtime verification** checks that one particular operation actually succeeded. A green test cannot prove a GitHub commit exists. The verifier must not accept a merely plausible-looking SHA as external confirmation.

## Ownership and boundaries

Matchbox owns registration, dispatch, contracts, reporting, and reconciliation rules. Calcifer supplies its host environment and durable recorder. Matches receive dependencies via context; matches may not dispatch other matches or import Matchbox's internal registry. Explicit composition only; no auto-discovery, globals, or import-time execution.

A future dispatcher must persist a pending strike before executing, verify the result, then persist terminal status before returning a light. Recorder failure fails closed. Expired pending strikes become `interrupted` via a host-owned reconciliation schedule and atomic storage transitions. Late completions require an explicit event trail, not historical overwriting.

```ts
import { defineMatch } from "./src/contract.js";

export const clock = defineMatch({
  name: "clock",
  input: { parse(value: unknown) {
    if (typeof value !== "string") throw new TypeError("zone must be a string");
    return value;
  } },
  run: (zone: string) => ({ zone, iso: new Date().toISOString() }),
  verify: result => Boolean(result.iso)
});
```

Run `npx tsc --noEmit` to check the TypeScript contract. The next bite integrates this contract with the dispatcher and recording boundary.
