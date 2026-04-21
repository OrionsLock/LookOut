import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { visualDiff } from "./visual-diff.js";

function solidPng(w: number, h: number, rgb: [number, number, number]) {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (w * y + x) << 2;
      png.data[idx] = rgb[0];
      png.data[idx + 1] = rgb[1];
      png.data[idx + 2] = rgb[2];
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

describe("visualDiff", () => {
  it("identical pngs have ~0 diff", () => {
    const png = solidPng(10, 10, [10, 20, 30]);
    const r = visualDiff(png, png, 0.02);
    expect(r.diffRatio).toBe(0);
    expect(r.exceedsThreshold).toBe(false);
  });

  it("different pngs exceed threshold", () => {
    const a = solidPng(10, 10, [0, 0, 0]);
    const b = solidPng(10, 10, [255, 255, 255]);
    const r = visualDiff(a, b, 0.0001);
    expect(r.diffRatio).toBeGreaterThan(0);
    expect(r.exceedsThreshold).toBe(true);
  });

  it("different sized images are compared on intersection and count extras as diffs", () => {
    // Identical top-left 10x10 area, but "b" is bigger; the extra pixels
    // must count as diff so a resized viewport never silently passes.
    const a = solidPng(10, 10, [10, 20, 30]);
    const b = solidPng(12, 12, [10, 20, 30]);
    const r = visualDiff(a, b, 0);
    expect(r.width).toBe(10);
    expect(r.height).toBe(10);
    expect(r.diffRatio).toBeGreaterThan(0);
    expect(r.exceedsThreshold).toBe(true);
  });

  it("counts the whole union as different when one image is drastically smaller", () => {
    // A 1x1 image vs a 10x10 image has union=100, intersection=1, so up to
    // 99 extra pixels must count as diffs even if the overlapping pixel
    // happens to match exactly.
    const tiny = solidPng(1, 1, [0, 0, 0]);
    const big = solidPng(10, 10, [0, 0, 0]);
    const r = visualDiff(tiny, big, 0.5);
    expect(r.diffRatio).toBeGreaterThan(0.9);
    expect(r.exceedsThreshold).toBe(true);
  });
});
