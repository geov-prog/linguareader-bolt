import { Camera, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThumbDock({
  hidden = false,
  hasCamera = true,
  onScan,
  onLook,
}: {
  hidden?: boolean;
  hasCamera?: boolean;
  onScan: () => void;
  onLook: () => void;
}) {
  if (hidden) return null;

  return (
    <div
      data-chrome="thumb"
      className="lr-thumb pointer-events-none fixed right-2 z-30 flex flex-col gap-1.5"
      style={{ bottom: "calc(var(--player-bar-height) + 0.5rem)" }}
    >
      {hasCamera ? (
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          onClick={onScan}
          aria-label="Scan with camera"
          className="pointer-events-auto size-9 shadow-[var(--shadow-border)]"
        >
          <Camera className="size-4" />
        </Button>
      ) : null}
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        onClick={onLook}
        aria-label="Look and reach"
        className="pointer-events-auto size-9 shadow-[var(--shadow-border)]"
      >
        <Palette className="size-4" />
      </Button>
    </div>
  );
}
