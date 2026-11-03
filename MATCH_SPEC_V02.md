# Matchbox v0.2 contract (bite 1 of 4)

> **No unrecorded success may be reported as a confirmed light.**
>
> **Interrupted means the outcome is unknown, not that the operation failed.**

Bite 2 supplies the typed dispatcher in `src/engine.ts` and exposes the compiled API through `src/index.ts`. The old `src/index.js` remains as a legacy v0.1 file; the package entrypoint now targets the built v0.2 engine. The reconciler and an actual durable storage adapter are not yet implemented.

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


## Bite 2: dispatch and recorder contract

`createMatchbox({ matches, recorder, dependencies, logger? })` explicitly composes inert matches; `dispatch(name, rawInput, { sessionId, signal? })` is the execution boundary. The recorder is required. `createPending(record)` must persist the pending strike before `run`. `settle(strikeId, outcome, durationMs)` must durably and atomically settle *only* a pending strike. The framework cannot make a non-atomic host adapter safe.

A bad schema or missing match is recorded as `blocked` without invoking match code. A thrown match or failed runtime verifier is `dud`. A verified success is `light` only after terminal persistence succeeds.

- If intent persistence fails, execution is blocked.
- If terminal persistence fails, dispatch **throws** an explicit unknown-outcome error rather than returning a light or incorrectly calling an unknown operation a dud. The pending record remains for reconciliation.
- The optional logger is informational only; it is not the authoritative recorder.
- Input summaries default to `[redacted]`; hosts must avoid writing sensitive input and errors into durable records.
- Deadline timestamps are recorded but are **not yet enforced**. Lease/heartbeat management, expiration, and interrupted-state reconciliation belong to bite 3.
- This package is still private pending bite 4 verification. No Cloudflare recorder adapter or production integration is included.
