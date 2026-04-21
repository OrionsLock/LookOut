import { describe, expect, it } from "vitest";
import { isNavigateAllowed } from "./explorer.js";

describe("isNavigateAllowed", () => {
  it("blocks non-http(s) URLs unconditionally", () => {
    for (const scheme of ["file:", "javascript:", "data:"]) {
      const u = new URL(`${scheme}///etc/passwd`);
      expect(isNavigateAllowed(u, "http://localhost:3000", "any")).toBe(false);
    }
  });

  it("enforces same-origin by default", () => {
    const base = "http://localhost:3000";
    expect(isNavigateAllowed(new URL("http://localhost:3000/about"), base, "same-origin")).toBe(true);
    // different port = different origin
    expect(isNavigateAllowed(new URL("http://localhost:4000/"), base, "same-origin")).toBe(false);
    // different host
    expect(isNavigateAllowed(new URL("http://example.com/"), base, "same-origin")).toBe(false);
  });

  it("allows anything when allowed=any", () => {
    const base = "http://localhost:3000";
    expect(isNavigateAllowed(new URL("https://example.com/"), base, "any")).toBe(true);
  });

  it("honours explicit origin allowlists (plus baseUrl)", () => {
    const base = "http://localhost:3000";
    const allowed = ["https://trusted.example.com"];
    expect(isNavigateAllowed(new URL("http://localhost:3000/x"), base, allowed)).toBe(true);
    expect(isNavigateAllowed(new URL("https://trusted.example.com/x"), base, allowed)).toBe(true);
    expect(isNavigateAllowed(new URL("https://evil.example.com/x"), base, allowed)).toBe(false);
  });
});
