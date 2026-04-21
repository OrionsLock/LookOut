import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export type VisualDiffResult = {
  diffRatio: number;
  diffPng: Buffer;
  width: number;
  height: number;
  exceedsThreshold: boolean;
};

/**
 * Compare two PNG buffers and produce a diff overlay image.
 */
export function visualDiff(baselinePng: Buffer, currentPng: Buffer, threshold: number): VisualDiffResult {
  const a = PNG.sync.read(baselinePng);
  const b = PNG.sync.read(currentPng);
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const diff = new PNG({ width, height });

  const total = width * height;
  const mismatch = pixelmatch(a.data, b.data, diff.data, width, height, {
    threshold: 0.1,
    includeAA: false,
  });
  const diffRatio = total === 0 ? 0 : mismatch / total;
  return {
    diffRatio,
    diffPng: PNG.sync.write(diff),
    width,
    height,
    exceedsThreshold: diffRatio > threshold,
  };
}
