import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

export function DropzoneHint({
  active,
  compact,
}: {
  active: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-dashed px-5 py-8 text-center transition-[border-color,background-color,transform] duration-[var(--motion-fast)] ease-[var(--ease-smooth-out)]",
        compact ? "py-5" : "py-10",
        active
          ? "border-pine bg-pine/8"
          : "border-line bg-paper-raised/60 hover:border-muted",
      )}
    >
      <Upload className="mx-auto mb-3 size-5 text-pine" strokeWidth={1.75} />
      <p className="font-sans text-sm font-medium text-ink">Drop a document</p>
      <p className="mt-1 font-sans text-xs text-muted">
        Word, PDF, EPUB, HTML, spreadsheets, and text convert on this device.
      </p>
    </div>
  );
}

export function DragOverlay({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-ink/30 px-6">
      <div className="w-full max-w-md rounded-xl bg-paper-raised px-8 py-10 text-center shadow-[var(--shadow-border-hover)]">
        <Upload className="mx-auto mb-3 size-6 text-pine" strokeWidth={1.75} />
        <p className="font-display text-2xl text-ink text-balance">Release to add to the library</p>
        <p className="mt-2 font-sans text-sm text-muted">
          Office files, PDF, EPUB, HTML, and signed backups convert locally.
        </p>
      </div>
    </div>
  );
}
