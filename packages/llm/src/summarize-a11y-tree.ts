import type { A11ySnapshot } from "@lookout/types";

const FOCUS_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "combobox",
  "checkbox",
  "radio",
  "heading",
  "dialog",
  "alert",
  "menu",
  "menuitem",
  "tab",
  "tabpanel",
  "form",
  "search",
]);

function formatNode(node: A11ySnapshot["root"], lines: string[]): void {
  const role = node.role;
  const name = node.name?.trim();
  const testId = node.testId;

  const keep =
    FOCUS_ROLES.has(role) ||
    (role !== "generic" && !!name) ||
    (role === "generic" && !!name) ||
    !!testId;

  if (keep) {
    const tid = testId ? ` [testid=${testId}]` : "";
    const label = name ? `${role} "${name}"${tid}` : `${role}${tid}`;
    lines.push(label);
  }

  for (const c of node.children ?? []) {
    formatNode(c, lines);
  }
}

/**
 * Compress an accessibility snapshot into a bounded text block suitable for LLM prompts.
 */
export function summarizeA11yTree(snapshot: A11ySnapshot): string {
  const lines: string[] = [];
  formatNode(snapshot.root, lines);
  const joined = lines.join("\n");
  const cap = 8000;
  if (joined.length <= cap) return joined;
  return `${joined.slice(0, cap)}\n... (truncated)`;
}
