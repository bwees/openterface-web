/**
 * Detects black borders on a video frame and returns crop insets.
 * Samples pixels along the edges to find where non-black content begins.
 */

const BLACK_THRESHOLD = 20; // Pixel brightness below this is "black"
const SAMPLE_STEP = 4; // Sample every Nth pixel for performance

export interface CropInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function isBlack(r: number, g: number, b: number): boolean {
  return r < BLACK_THRESHOLD && g < BLACK_THRESHOLD && b < BLACK_THRESHOLD;
}

/**
 * Analyze a video frame and return the crop insets (in fractions 0-1).
 * Uses an offscreen canvas to read pixel data.
 */
export function detectCropInsets(
  video: HTMLVideoElement,
  canvas: OffscreenCanvas | HTMLCanvasElement,
): CropInsets {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw === 0 || vh === 0) return { top: 0, bottom: 0, left: 0, right: 0 };

  // Use a downscaled version for performance
  const scale = Math.min(1, 320 / Math.max(vw, vh));
  const sw = Math.round(vw * scale);
  const sh = Math.round(vh * scale);

  canvas.width = sw;
  canvas.height = sh;

  const ctx = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D;
  if (!ctx) return { top: 0, bottom: 0, left: 0, right: 0 };

  ctx.drawImage(video, 0, 0, sw, sh);
  const imageData = ctx.getImageData(0, 0, sw, sh);
  const d = imageData.data;

  const px = (x: number, y: number) => {
    const i = (y * sw + x) * 4;
    return { r: d[i], g: d[i + 1], b: d[i + 2] };
  };

  // Scan from top
  let top = 0;
  topLoop: for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x += SAMPLE_STEP) {
      const { r, g, b } = px(x, y);
      if (!isBlack(r, g, b)) break topLoop;
    }
    top = y + 1;
  }

  // Scan from bottom
  let bottom = 0;
  bottomLoop: for (let y = sh - 1; y >= top; y--) {
    for (let x = 0; x < sw; x += SAMPLE_STEP) {
      const { r, g, b } = px(x, y);
      if (!isBlack(r, g, b)) break bottomLoop;
    }
    bottom = sh - y;
  }

  // Scan from left
  let left = 0;
  leftLoop: for (let x = 0; x < sw; x++) {
    for (let y = top; y < sh - bottom; y += SAMPLE_STEP) {
      const { r, g, b } = px(x, y);
      if (!isBlack(r, g, b)) break leftLoop;
    }
    left = x + 1;
  }

  // Scan from right
  let right = 0;
  rightLoop: for (let x = sw - 1; x >= left; x--) {
    for (let y = top; y < sh - bottom; y += SAMPLE_STEP) {
      const { r, g, b } = px(x, y);
      if (!isBlack(r, g, b)) break rightLoop;
    }
    right = sw - x;
  }

  // Convert to fractions, add small margin to avoid cutting content
  const margin = 0.002;
  return {
    top: Math.max(0, top / sh - margin),
    bottom: Math.max(0, bottom / sh - margin),
    left: Math.max(0, left / sw - margin),
    right: Math.max(0, right / sw - margin),
  };
}
