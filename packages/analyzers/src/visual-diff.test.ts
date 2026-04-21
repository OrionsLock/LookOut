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
});
