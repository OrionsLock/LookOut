import { describe, expect, it } from "vitest";
import { extractFirstJsonObject, parseJudgeVerdict } from "./judge-run.js";

describe("extractFirstJsonObject", () => {
  it("parses object embedded in prose", () => {
    const j = extractFirstJsonObject('here you go {"verdict":"accept","confidence":0.9,"rationale":"ok"} thanks');
    expect(j).toEqual({ verdict: "accept", confidence: 0.9, rationale: "ok" });
  });

  it("returns undefined when no object", () => {
    expect(extractFirstJsonObject("no json")).toBeUndefined();
  });
});

describe("parseJudgeVerdict", () => {
  it("accepts valid payload", () => {
    const r = parseJudgeVerdict({ verdict: "reject", confidence: 0.4, rationale: "major flow" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.verdict).toBe("reject");
  });
});
