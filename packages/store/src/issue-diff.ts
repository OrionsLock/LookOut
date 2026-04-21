import type { Issue } from "@lookout/types";

/** Stable key for comparing logical issues across runs (same severity/category/title). */
export function issueFingerprint(i: Pick<Issue, "severity" | "category" | "title">): string {
  return `${i.severity}\t${i.category}\t${i.title}`;
}

function groupByFingerprint(issues: Issue[]): Map<string, Issue[]> {
  const m = new Map<string, Issue[]>();
  for (const i of issues) {
    const k = issueFingerprint(i);
    const arr = m.get(k);
    if (arr) arr.push(i);
    else m.set(k, [i]);
  }
  return m;
}

export type IssuesDiff = {
  onlyInA: Issue[];
  onlyInB: Issue[];
  inBoth: Issue[];
};

export function diffIssuesByFingerprint(a: Issue[], b: Issue[]): IssuesDiff {
  const ma = groupByFingerprint(a);
  const mb = groupByFingerprint(b);
  const keysA = new Set(ma.keys());
  const keysB = new Set(mb.keys());

  const onlyInA: Issue[] = [];
  const onlyInB: Issue[] = [];
  const inBoth: Issue[] = [];

  for (const k of keysA) {
    if (!keysB.has(k)) {
      onlyInA.push(...(ma.get(k) ?? []));
    } else {
      const first = ma.get(k)?.[0];
      if (first) inBoth.push(first);
    }
  }
  for (const k of keysB) {
    if (!keysA.has(k)) {
      onlyInB.push(...(mb.get(k) ?? []));
    }
  }

  return { onlyInA, onlyInB, inBoth };
}
