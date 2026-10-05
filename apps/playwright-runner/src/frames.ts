import type { Page } from "playwright";
import type { Gray } from "./locate.ts";

// Both run in a blank helper page. Kept as source text so the TS toolchain cannot rewrite them.
const ANALYSE_SOURCE = `
(async function (base64) {
  var blob = await (await fetch("data:image/png;base64," + base64)).blob();
  var bitmap = await createImageBitmap(blob);
  var size = 64;
  var canvas = new OffscreenCanvas(size, size);
  var ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, size, size);
  var data = ctx.getImageData(0, 0, size, size).data;
  var counts = {};
  var top = 0;
  var gray = [];
  for (var i = 0; i < data.length; i += 4) {
    var key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    counts[key] = (counts[key] || 0) + 1;
    if (counts[key] > top) top = counts[key];
    gray.push(Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]));
  }
  return { dominant: top / (size * size), gray: gray };
})
`;

const SHRINK_SOURCE = `
(async function (base64, maxSide) {
  var blob = await (await fetch("data:image/png;base64," + base64)).blob();
  var bitmap = await createImageBitmap(blob);
  var scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  var w = Math.max(1, Math.round(bitmap.width * scale));
  var h = Math.max(1, Math.round(bitmap.height * scale));
  var canvas = new OffscreenCanvas(w, h);
  var ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  var out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.72 });
  var bytes = new Uint8Array(await out.arrayBuffer());
  var text = "";
  for (var i = 0; i < bytes.length; i += 1) text += String.fromCharCode(bytes[i]);
  return btoa(text);
})
`;

const GRAY_SOURCE = `
(async function (base64, w, h) {
  var blob = await (await fetch("data:image/png;base64," + base64)).blob();
  var bitmap = await createImageBitmap(blob);
  var canvas = new OffscreenCanvas(w, h);
  var ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  var data = ctx.getImageData(0, 0, w, h).data;
  var gray = new Array(w * h);
  for (var i = 0, k = 0; i < data.length; i += 4, k += 1) {
    gray[k] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  return gray;
})
`;

export interface FrameStats {
  dominant: number;
  gray: number[];
}

export const analyse = async (helper: Page, png: Buffer): Promise<FrameStats> =>
  (await helper.evaluate(`${ANALYSE_SOURCE}(${JSON.stringify(png.toString("base64"))})`)) as FrameStats;

export const frameDifference = (a: FrameStats, b: FrameStats): number => {
  let total = 0;
  for (let i = 0; i < a.gray.length; i += 1) {
    total += Math.abs(a.gray[i] - b.gray[i]);
  }
  return total / (a.gray.length || 1);
};

/**
 * A screenshot small enough to be cheap for a vision model: JPEG, longest
 * side `maxSide`. Image tokens grow with the pixel count.
 */
export const shrinkToJpeg = async (helper: Page, png: Buffer, maxSide: number): Promise<string> =>
  (await helper.evaluate(
    `${SHRINK_SOURCE}(${JSON.stringify(png.toString("base64"))}, ${Math.round(maxSide)})`
  )) as string;

/** A screenshot as a grayscale picture with one sample per `unit` CSS px of a `cssWidth`×`cssHeight` screen. */
export const grayFrame = async (
  helper: Page,
  png: Buffer,
  cssWidth: number,
  cssHeight: number,
  unit: number
): Promise<Gray> => {
  const w = Math.max(1, Math.round(cssWidth / unit));
  const h = Math.max(1, Math.round(cssHeight / unit));
  const gray = (await helper.evaluate(`${GRAY_SOURCE}(${JSON.stringify(png.toString("base64"))}, ${w}, ${h})`)) as number[];
  return { w, h, unit: cssWidth / w, px: Float32Array.from(gray) };
};
