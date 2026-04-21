import { describe, expect, it } from "vitest";
import { parseModelJsonToAction } from "./json-action.js";

describe("parseModelJsonToAction", () => {
  it("parses fenced json", () => {
    const r = parseModelJsonToAction(
      "```json\n{\"kind\":\"wait\",\"ms\":0,\"intent\":\"x\"}\n```",
    );
    expect(r.ok).toBe(true);
  });

  it("rejects malformed json", () => {
    const r = parseModelJsonToAction("not json");
    expect(r.ok).toBe(false);
  });

  it("rejects schema mismatch", () => {
    const r = parseModelJsonToAction("{\"kind\":\"nope\"}");
    expect(r.ok).toBe(false);
  });
});
