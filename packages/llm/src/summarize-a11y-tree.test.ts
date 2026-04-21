import { describe, expect, it } from "vitest";
import type { A11ySnapshot } from "@lookout/types";
import { summarizeA11yTree } from "./summarize-a11y-tree.js";

describe("summarizeA11yTree", () => {
  it("keeps focused roles and caps length", () => {
    const snap: A11ySnapshot = {
      url: "http://localhost/",
      title: "t",
      root: {
        role: "generic",
        children: [
          { role: "button", name: "Go" },
          { role: "textbox", name: "Email" },
          ...Array.from({ length: 5000 }, () => ({
            role: "button" as const,
            name: "x".repeat(20),
          })),
        ],
      },
    };
    const s = summarizeA11yTree(snap);
    expect(s.length).toBeLessThanOrEqual(8000 + 30);
    expect(s).toContain('button "Go"');
  });
});
