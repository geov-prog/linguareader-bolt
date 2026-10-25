export const FONT_CHOICES = [
  { id: "serif", label: "Serif · book", sample: "春眠不觉晓" },
  { id: "sans", label: "Sans · clear", sample: "Spring morning" },
  { id: "kai", label: "楷体 · brush", sample: "静夜思" },
  { id: "song", label: "宋体 · print", sample: "床前明月光" },
] as const;

export const ACCENT_CHOICES = [
  { id: "pine", label: "Pine" },
  { id: "clay", label: "Clay" },
  { id: "indigo", label: "Indigo" },
  { id: "plum", label: "Plum" },
] as const;

export const WALLPAPER_CHOICES = [
  { id: "none", label: "Plain paper" },
  { id: "linen", label: "Linen" },
  { id: "moss", label: "Moss" },
  { id: "dusk", label: "Dusk" },
  { id: "ink", label: "Ink wash" },
  { id: "custom", label: "My photo" },
] as const;

export const CONTROL_SIZES = [
  { id: "compact", label: "Compact" },
  { id: "comfortable", label: "Comfortable" },
  { id: "large", label: "Thumb-size" },
] as const;

export type FontId = (typeof FONT_CHOICES)[number]["id"];
export type AccentId = (typeof ACCENT_CHOICES)[number]["id"];
export type WallpaperId = (typeof WALLPAPER_CHOICES)[number]["id"];
export type ControlSizeId = (typeof CONTROL_SIZES)[number]["id"];
export type HandId = "right" | "left";

export function applyAppearance(opts: {
  theme: "paper" | "night";
  fontFamily: FontId;
  accent: AccentId;
  wallpaper: WallpaperId;
  controlSize: ControlSizeId;
  focusMode: boolean;
  hand: HandId;
  wallpaperUrl?: string | null;
}): void {
  const root = document.documentElement;
  root.dataset.theme = opts.theme;
  root.dataset.font = opts.fontFamily;
  root.dataset.accent = opts.accent;
  root.dataset.wallpaper = opts.wallpaper;
  root.dataset.control = opts.controlSize;
  root.dataset.focus = opts.focusMode ? "on" : "off";
  root.dataset.hand = opts.hand;
  if (opts.wallpaper === "custom" && opts.wallpaperUrl) {
    root.style.setProperty("--wallpaper", `url("${opts.wallpaperUrl}")`);
  } else {
    root.style.removeProperty("--wallpaper");
  }
}
