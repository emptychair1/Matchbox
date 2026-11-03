/**
 * Matchbox v0.2 contract. No runtime, persistence, or provider dependency.
 * A match definition is inert; only the box may dispatch it.
 */
export type MaybePromise<T> = T | Promise<T>;

export interface InputSchema<Input> {
  parse(value: unknown): Input;
}

export interface MatchContext<Dependencies = unknown> {
  readonly sessionId: string;
  readonly dependencies: Readonly<Dependencies>;
  readonly signal: AbortSignal;
}

export interface MatchSpec<Input, Value, Dependencies = unknown> {
  readonly name: string;
  readonly input: InputSchema<Input>;
  readonly run: (input: Input, context: MatchContext<Dependencies>) => MaybePromise<Value>;
  /** Must establish success; a returned value alone is NOT proof. */
  readonly verify: (value: Value, input: Input, context: MatchContext<Dependencies>) => MaybePromise<boolean>;
  /** Redacted, bounded description. Never persist raw sensitive input by default. */
  readonly summarizeInput?: (input: Input) => string;
  readonly timeoutMs?: number;
}

export type MatchExecutionOutcome<Value> =
  | { readonly status: "light"; readonly value: Value }
  | { readonly status: "dud"; readonly error: string }
  | { readonly status: "blocked"; readonly reason: string };

export type MatchObservation<Value> =
  | MatchExecutionOutcome<Value>
  | { readonly status: "unstruck" }
  | { readonly status: "interrupted"; readonly reason: string };

export type MatchRecordStatus = "pending" | "light" | "dud" | "blocked" | "interrupted";

export interface MatchRecord {
  readonly strikeId: string;
  readonly matchName: string;
  readonly sessionId: string;
  readonly inputSummary: string;
  readonly startedAt: string;
  readonly deadlineAt: string;
  readonly status: MatchRecordStatus;
  readonly durationMs?: number;
  readonly error?: string;
}

/** Registration is inert: no match runs during definition. */
export function defineMatch<Input, Value, Dependencies = unknown>(
  spec: MatchSpec<Input, Value, Dependencies>
): MatchSpec<Input, Value, Dependencies> {
  if (!spec || typeof spec.name !== "string" || !spec.name.trim()) {
    throw new TypeError("A match needs a nonempty name");
  }
  if (typeof spec.input?.parse !== "function") {
    throw new TypeError("A match needs input.parse(value)");
  }
  if (typeof spec.run !== "function") {
    throw new TypeError("A match needs run(input, context)");
  }
  if (typeof spec.verify !== "function") {
    throw new TypeError("A match needs verify(value, input, context)");
  }
  if (spec.timeoutMs !== undefined && (!Number.isFinite(spec.timeoutMs) || spec.timeoutMs <= 0)) {
    throw new TypeError("timeoutMs must be a positive finite number");
  }
  return Object.freeze({ ...spec });
}
