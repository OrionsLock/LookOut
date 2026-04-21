import { describe, expect, it } from "vitest";
import { parseMockActionsJson } from "./mock-llm.js";
import { parseModelJsonToAction } from "./json-action.js";

describe("eval: golden JSON actions", () => {
  it("parses click action from model-shaped JSON", () => {
    const raw = `{"kind":"click","target":{"description":"x","role":"button","name":"OK"},"intent":"ack"}`;
    const r = parseModelJsonToAction(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.kind).toBe("click");
  });

  it("parses LOOKOUT_MOCK_ACTIONS-style array entries", () => {
    const script = parseMockActionsJson(
      `[{"kind":"wait","ms":0,"intent":"noop"},{"kind":"complete","reason":"done"}]`,
    );
    expect(script).toHaveLength(2);
    expect(script[1]?.kind).toBe("complete");
  });
});
