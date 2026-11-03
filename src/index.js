export function createMatchbox(matches = [], { onEvent = () => {} } = {}) {
  const registry = new Map();
  const expected = new Set();
  const struck = new Set();

  function register(match) {
    if (!match || typeof match.name !== "string" || !match.name.trim() || typeof match.run !== "function") {
      throw new TypeError("A match needs a name and run(input, context)");
    }
    if (registry.has(match.name)) throw new Error(`Duplicate match: ${match.name}`);
    registry.set(match.name, match);
    return match.name;
  }

  function emit(event) {
    try { onEvent(Object.freeze(event)); } catch { /* observers must not break execution */ }
  }

  function expect(name) {
    expected.add(name);
    struck.delete(name);
  }

  function report() {
    return { unstruck: [...expected].filter(name => !struck.has(name)) };
  }

  async function strike(name, input, context = {}) {
    struck.add(name);
    const startedAt = Date.now();
    emit({ type: "strike", name });
    const finish = (status, data = {}) => {
      const result = { name, status, ...data };
      emit({ type: status, name, durationMs: Date.now() - startedAt });
      return result;
    };
    const match = registry.get(name);
    if (!match) return finish("blocked", { error: "Match not registered" });
    try {
      if (match.validate && !(await match.validate(input))) {
        return finish("blocked", { error: "Input rejected" });
      }
      const value = await match.run(input, context);
      const valid = match.verify ? await match.verify(value) : value !== undefined;
      if (!valid) return finish("dud", { error: "Result not verified" });
      return finish("light", { value });
    } catch (error) {
      return finish("dud", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const match of matches) register(match);
  return Object.freeze({ register, strike, expect, report, names: () => [...registry.keys()] });
}
