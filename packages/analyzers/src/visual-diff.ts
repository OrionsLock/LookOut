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
 * Crop a PNG's raw RGBA data down to a smaller width/height, keeping the
 * top-left origin. `pixelmatch` assumes the passed buffers cover exactly
 * `width * height` pixels, so shrinking the comparison rectangle requires
 * re-packing the source rows too.
 */
function cropRgba(src: Buffer, srcW: number, srcH: number, w: number, h: number): Buffer {
  if (srcW === w && srcH === h) return src;
  const out = Buffer.alloc(w * h * 4);
  const rowBytes = w * 4;
  const srcRow = srcW * 4;
  for (let y = 0; y < h; y++) {
    src.copy(out, y * rowBytes, y * srcRow, y * srcRow + rowBytes);
  }
  return out;
}

/**
 * Compare two PNG buffers and produce a diff overlay image. When the two
 * images differ in size, the comparison uses the top-left intersection and
 * any pixels in the union that fall outside that rectangle count as a diff.
 */
export function visualDiff(baselinePng: Buffer, currentPng: Buffer, threshold: number): VisualDiffResult {
  const a = PNG.sync.read(baselinePng);
  const b = PNG.sync.read(currentPng);
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const diff = new PNG({ width, height });

  const intersection = width * height;
  const union = Math.max(a.width, b.width) * Math.max(a.height, b.height);
  let mismatch = 0;
  if (intersection > 0) {
    const aData = cropRgba(a.data, a.width, a.height, width, height);
    const bData = cropRgba(b.data, b.width, b.height, width, height);
    mismatch = pixelmatch(aData, bData, diff.data, width, height, {
      threshold: 0.1,
      includeAA: false,
    });
  }
  const outsideIntersection = Math.max(0, union - intersection);
  const totalDifferent = mismatch + outsideIntersection;
  const denom = union > 0 ? union : 1;
  const diffRatio = totalDifferent / denom;
  return {
    diffRatio,
    diffPng: PNG.sync.write(diff),
    width,
    height,
    exceedsThreshold: diffRatio > threshold,
  };
}
