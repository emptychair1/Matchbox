# Match specification (v0.1)

A **match** is an ordinary JavaScript object with:

- `name`: unique, nonempty identifier.
- `run(input, context)`: asynchronous or synchronous function returning a result.
- `validate(input)` (optional): returns `true` for accepted input, or `false` to block execution.
- `verify(value)` (optional): returns `true` only when the returned value is a confirmed success. If omitted, a returned value other than `undefined` counts as success. For externally consequential actions, supply an explicit verifier.

```js
const clock = {
  name: "clock",
  run: async () => ({ iso: new Date().toISOString() }),
  verify: value => typeof value?.iso === "string"
};
```

Matchbox registers matches and runs them by name. A match does not import other matches. Its context is provided by the host application. Matchbox is runtime- and provider-independent.

## Reporting contract

Each `strike(name, input, context)` returns a result envelope:
- `status: "light"`: executed and verified; `value` contains the result.
- `status: "dud"`: executed but threw, returned `undefined`, or failed verification; `error` describes the failure.
- `status: "blocked"`: missing match or rejected input; `error` explains why.

Every attempted invocation emits a `strike` event followed by exactly one terminal `light`, `dud`, or `blocked` event. A missing match is blocked, not executed.

`unstruck` is an **expectation-level** observation, not a match result. The host must explicitly mark an expected call using `expect(name)`; `report()` lists expected names not struck since their most recent expectation. A match cannot report that it was never invoked.

Errors are returned as data, not thrown across the host's execution boundary. This contains ordinary exceptions, not arbitrary side effects or runtime termination. Matches must use timeouts and cancellation at their I/O boundaries when appropriate.

## Modification rule

Change one match without editing unrelated matches. Preserve its declared contract. Run all tests, including failure-isolation tests. Never equate an attempted call with a verified success.
