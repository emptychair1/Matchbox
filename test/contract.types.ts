import { defineMatch, type MatchExecutionOutcome, type MatchObservation } from "../src/contract.js";

const clock = defineMatch({
  name: "clock",
  input: { parse: (value: unknown): string => {
    if (typeof value !== "string") throw new TypeError("expected string");
    return value;
  } },
  run: (input: string, context: { readonly sessionId: string; readonly dependencies: Readonly<{ zone: string }>; readonly signal: AbortSignal }) =>
    ({ iso: input, zone: context.dependencies.zone }),
  verify: (value: { iso: string; zone: string }) => value.iso.length > 0
});
void clock;

function consumed(outcome: MatchExecutionOutcome<{ ok: true }>): string {
  switch (outcome.status) {
    case "light": return outcome.value.ok ? "ok" : "invalid";
    case "dud": return outcome.error;
    case "blocked": return outcome.reason;
  }
}
void consumed;
const missing: MatchObservation<string> = { status: "unstruck" };
void missing;
// @ts-expect-error unstruck is not a dispatch result
const invalid: MatchExecutionOutcome<string> = { status: "unstruck" };
void invalid;
// @ts-expect-error light requires a value
const noValue: MatchExecutionOutcome<string> = { status: "light" };
void noValue;
