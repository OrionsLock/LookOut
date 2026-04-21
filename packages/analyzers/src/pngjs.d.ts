declare module "pngjs" {
  import type { Buffer } from "node:buffer";

  export type PngData = { width: number; height: number; data: Buffer };

  export class PNG implements PngData {
    width: number;
    height: number;
    data: Buffer;
    constructor(opts: { width: number; height: number });
    static sync: {
      read(data: Buffer): PngData;
      write(png: PNG): Buffer;
    };
  }
}
