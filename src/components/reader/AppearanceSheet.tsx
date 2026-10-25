import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import {
  ACCENT_CHOICES,
  CONTROL_SIZES,
  FONT_CHOICES,
  WALLPAPER_CHOICES,
} from "@/lib/appearance";
import type { AppSettings } from "@/services/StorageService";

export function AppearanceSheet({
  open,
  settings,
  onOpenChange,
  onPatch,
  onUploadWallpaper,
  onClearVoiceCache,
}: {
  open: boolean;
  settings: AppSettings;
  onOpenChange: (open: boolean) => void;
  onPatch: (patch: Partial<AppSettings>) => void;
  onUploadWallpaper: () => void;
  onClearVoiceCache?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(28rem,calc(100vw-1.5rem))] max-h-[min(88dvh,40rem)] overflow-y-auto">
        <DialogTitle>Look & reach</DialogTitle>
        <DialogDescription>
          Tune the page for one-handed reading. Bigger controls sit in the thumb zone; wallpaper stays behind the words.
        </DialogDescription>

        <section className="mt-4">
          <p className="font-sans text-xs font-medium tracking-widest text-muted uppercase">Type</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {FONT_CHOICES.map((font) => (
              <button
                key={font.id}
                type="button"
                onClick={() => onPatch({ fontFamily: font.id })}
                className={`rounded-lg px-3 py-2 text-left shadow-[var(--shadow-border)] ${
                  settings.fontFamily === font.id ? "bg-mark" : "bg-paper-sunken"
                }`}
              >
                <span className="block font-sans text-xs text-muted">{font.label}</span>
                <span className="mt-1 block font-serif text-lg text-ink">{font.sample}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="w-10 font-sans text-xs text-muted">Size</span>
            <Slider
              min={15}
              max={32}
              step={1}
              value={[settings.fontSize]}
              onValueChange={(v) => onPatch({ fontSize: v[0] ?? 19 })}
              aria-label="Reading size"
            />
            <span className="w-8 text-right font-sans text-xs tabular-nums text-muted">{settings.fontSize}</span>
          </div>
        </section>

        <section className="mt-5">
          <p className="font-sans text-xs font-medium tracking-widest text-muted uppercase">Accent</p>
          <div className="mt-2 flex gap-2">
            {ACCENT_CHOICES.map((accent) => (
              <button
                key={accent.id}
                type="button"
                aria-label={accent.label}
                onClick={() => onPatch({ accent: accent.id })}
                className={`size-9 rounded-full shadow-[var(--shadow-border)] ${
                  settings.accent === accent.id ? "ring-2 ring-ink/40 ring-offset-2 ring-offset-paper" : ""
                }`}
                data-swatch={accent.id}
              />
            ))}
          </div>
        </section>

        <section className="mt-5">
          <p className="font-sans text-xs font-medium tracking-widest text-muted uppercase">Wallpaper</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {WALLPAPER_CHOICES.map((paper) => (
              <button
                key={paper.id}
                type="button"
                onClick={() => {
                  onPatch({ wallpaper: paper.id });
                  if (paper.id === "custom") onUploadWallpaper();
                }}
                className={`rounded-lg px-2 py-2 font-sans text-xs ${
                  settings.wallpaper === paper.id ? "bg-mark text-ink" : "bg-paper-sunken text-muted"
                }`}
              >
                {paper.label}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-5">
          <p className="font-sans text-xs font-medium tracking-widest text-muted uppercase">Thumb zone</p>
          <div className="mt-2 flex gap-2">
            {CONTROL_SIZES.map((size) => (
              <button
                key={size.id}
                type="button"
                onClick={() => onPatch({ controlSize: size.id })}
                className={`flex-1 rounded-lg py-2 font-sans text-xs ${
                  settings.controlSize === size.id ? "bg-mark text-ink" : "bg-paper-sunken text-muted"
                }`}
              >
                {size.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => onPatch({ hand: "right" })}
              className={`flex-1 rounded-lg py-2 font-sans text-xs ${
                settings.hand === "right" ? "bg-mark text-ink" : "bg-paper-sunken text-muted"
              }`}
            >
              Right thumb
            </button>
            <button
              type="button"
              onClick={() => onPatch({ hand: "left" })}
              className={`flex-1 rounded-lg py-2 font-sans text-xs ${
                settings.hand === "left" ? "bg-mark text-ink" : "bg-paper-sunken text-muted"
              }`}
            >
              Left thumb
            </button>
          </div>
        </section>

        <div className="mt-5 flex items-center justify-between gap-3">
          {onClearVoiceCache ? (
            <Button type="button" variant="outline" size="sm" onClick={onClearVoiceCache}>
              Delete voice cache
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
