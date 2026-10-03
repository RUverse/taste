/** Sizes and thumbnails for images added in the viewer, matching what the Python library stores. */

/** Images with a longer edge than this get a thumbnail; the spec recommends it above 512 pixels. */
export const THUMB_EDGE = 512;

export interface ImageInfo {
  width?: number;
  height?: number;
  thumb?: Blob;
}

/** The pixel size of an image and, when it is large, a WebP (or JPEG) thumbnail. */
export async function describeImage(data: Blob): Promise<ImageInfo> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(data);
  } catch {
    // Formats the browser cannot decode (HEIC in most browsers) are stored without a size.
    return {};
  }
  try {
    const { width, height } = bitmap;
    if (Math.max(width, height) <= THUMB_EDGE || data.type === "image/svg+xml") return { width, height };
    const scale = THUMB_EDGE / Math.max(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) return { width, height };
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let thumb = await encode(canvas, "image/webp", 0.8);
    // Browsers that cannot write WebP fall back to PNG, which is too large for a thumbnail.
    if (thumb?.type !== "image/webp") thumb = await encode(canvas, "image/jpeg", 0.85);
    return thumb ? { width, height, thumb } : { width, height };
  } finally {
    bitmap.close();
  }
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
