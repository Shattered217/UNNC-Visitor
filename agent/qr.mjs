import jsQR from "jsqr";
import { PNG } from "pngjs";

export function paddedPng(bytes) {
  const source = PNG.sync.read(bytes);
  const side = Math.max(source.width, source.height);
  const margin = Math.ceil(side / 3);
  const size = side + 2 * margin;
  const canvas = new PNG({ width: size, height: size });
  canvas.data.fill(255);
  // Copy the official pixels without resampling the QR modules.
  PNG.bitblt(source, canvas, 0, 0, source.width, source.height,
    Math.floor((size - source.width) / 2), Math.floor((size - source.height) / 2));
  return PNG.sync.write(canvas);
}

export function officialPng(dataUrl, expectedCode) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,") || dataUrl.length > 180000) throw new Error("qr_unavailable");
  try {
    const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
    // Check dimensions before allocating memory in the PNG decoder.
    if (bytes.length < 24 || bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a"
      || bytes.readUInt32BE(16) > 1024 || bytes.readUInt32BE(20) > 1024) throw new Error();
    const png = PNG.sync.read(bytes);
    const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    if (!code || code.data !== expectedCode) throw new Error();
    return bytes.toString("base64");
  } catch { throw new Error("qr_unavailable"); }
}
