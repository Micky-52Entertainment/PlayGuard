import type {
  DeviceProfile,
  FitMode,
  Orientation,
  Rect,
  ViewportSnapshot,
} from "@playable-lab/protocol";
import { fullContentRect } from "@playable-lab/protocol";

export const clamp01 = (value: number): number => {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
};

export const orientationFromSize = (
  width: number,
  height: number
): Orientation | "square" => {
  if (width === height) {
    return "square";
  }
  return width > height ? "landscape" : "portrait";
};

export const deviceCssSize = (
  device: DeviceProfile,
  orientation: Orientation
): { cssWidth: number; cssHeight: number } => {
  const exact = device.sizes?.[orientation];
  if (exact) {
    return { cssWidth: exact.w, cssHeight: exact.h };
  }
  const shortSide = Math.min(device.width, device.height);
  const longSide = Math.max(device.width, device.height);
  return orientation === "portrait"
    ? { cssWidth: shortSide, cssHeight: longSide }
    : { cssWidth: longSide, cssHeight: shortSide };
};

export const containRect = (
  viewportWidth: number,
  viewportHeight: number,
  designWidth: number,
  designHeight: number
): Rect => {
  const scale = Math.min(
    viewportWidth / designWidth,
    viewportHeight / designHeight
  );
  const w = designWidth * scale;
  const h = designHeight * scale;
  return {
    x: (viewportWidth - w) / 2,
    y: (viewportHeight - h) / 2,
    w,
    h,
  };
};

export const contentRectFor = (
  cssWidth: number,
  cssHeight: number,
  fit: FitMode,
  designWidth?: number,
  designHeight?: number
): Rect => {
  if (
    fit === "contain" &&
    designWidth &&
    designHeight &&
    designWidth > 0 &&
    designHeight > 0
  ) {
    return containRect(cssWidth, cssHeight, designWidth, designHeight);
  }
  return fullContentRect(cssWidth, cssHeight);
};

export const viewportForDevice = (
  device: DeviceProfile,
  orientation: Orientation,
  fit: FitMode = "stretch",
  designWidth?: number,
  designHeight?: number
): ViewportSnapshot => {
  const { cssWidth, cssHeight } = deviceCssSize(device, orientation);
  return {
    cssWidth,
    cssHeight,
    dpr: device.dpr,
    orientation,
    fit,
    contentRect: contentRectFor(
      cssWidth,
      cssHeight,
      fit,
      designWidth,
      designHeight
    ),
  };
};

export const mapToTarget = (
  nx: number,
  ny: number,
  target: ViewportSnapshot
): { x: number; y: number } => {
  const x = target.contentRect.x + clamp01(nx) * target.contentRect.w;
  const y = target.contentRect.y + clamp01(ny) * target.contentRect.h;
  return { x, y };
};

export const normalizeFromClient = (
  clientX: number,
  clientY: number,
  viewport: ViewportSnapshot
): { nx: number; ny: number } => {
  const { x, y, w, h } = viewport.contentRect;
  return {
    nx: clamp01((clientX - x) / (w || 1)),
    ny: clamp01((clientY - y) / (h || 1)),
  };
};
