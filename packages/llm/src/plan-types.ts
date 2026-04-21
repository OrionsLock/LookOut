import type { Action, A11ySnapshot, Verdict } from "@lookout/types";

export type PlanInput = {
  goal: string;
  stepHistory: Array<{ action: Action; verdict: Verdict }>;
  perception: {
    url: string;
    title: string;
    a11yTree: A11ySnapshot;
    screenshotPng: Buffer;
  };
};
