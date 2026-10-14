import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEEPSEEK_ICON_DATA_URI } from "../client/deepseek-icon-data.js";

const root = join(import.meta.dirname, "..");
const PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("sidebar icon", () => {
  it("is a data URI, because the client bundler has no loader for image files", () => {
    expect(DEEPSEEK_ICON_DATA_URI.startsWith(PREFIX)).toBe(true);
  });

  it("keeps the shape of icon.svg, so the raster and the source cannot drift apart", async () => {
    const png = Buffer.from(DEEPSEEK_ICON_DATA_URI.slice(PREFIX.length), "base64");
    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);

    const svg = await readFile(join(root, "icon.svg"), "utf8");
    const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1].trim().split(/\s+/).map(Number);
    if (!viewBox || viewBox.length !== 4) throw new Error("icon.svg has no usable viewBox");
    const [, , width, height] = viewBox;

    // IHDR carries width and height as big-endian uint32s after the 8 signature and 8 chunk bytes.
    expect(png.readUInt32BE(16) / png.readUInt32BE(20)).toBeCloseTo(width / height, 2);
  });
});
