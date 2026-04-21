import type { Goal, Issue, Run, Step } from "@lookout/types";

export type UXScore = {
  scores: {
    informationDensity: number;
    ctaClarity: number;
    copyClarity: number;
    visualHierarchy: number;
    cognitiveLoad: number;
  };
  concerns: Array<{
    severity: "minor" | "moderate" | "serious";
    title: string;
    detail: string;
  }>;
};

export type VisualDiffSummary = {
  url: string;
  diffImagePath: string | undefined;
  diffRatio: number | undefined;
};

export type ReportData = {
  run: Run;
  goals: Array<Goal & { steps: Step[]; issues: Issue[] }>;
  issues: Issue[];
  pages: Array<{
    url: string;
    visits: number;
    firstStepId: string;
    a11yScore: number | null;
    visualDiff?: VisualDiffSummary;
    uxAudit?: UXScore;
  }>;
};
