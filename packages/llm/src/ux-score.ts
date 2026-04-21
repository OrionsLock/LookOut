import { z } from "zod";

export const UXScoreSchema = z.object({
  scores: z.object({
    informationDensity: z.number().min(0).max(5),
    ctaClarity: z.number().min(0).max(5),
    copyClarity: z.number().min(0).max(5),
    visualHierarchy: z.number().min(0).max(5),
    cognitiveLoad: z.number().min(0).max(5),
  }),
  concerns: z.array(
    z.object({
      severity: z.enum(["minor", "moderate", "serious"]),
      title: z.string(),
      detail: z.string(),
    }),
  ),
});

export type UXScore = z.infer<typeof UXScoreSchema>;
