import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { isIOSDevice } from "@/lib/browser";
import {
  ANDROID_APK_HREF,
  ANDROID_APK_NAME,
  openInstallFile,
} from "@/lib/downloads";
import { APP_VERSION_LABEL } from "@/lib/app-info";
import { formatRelativeTime } from "@/lib/utils";
import type { TypedBackupSlots } from "@/services/StorageService";

const KINDS = [
  {
    id: "settings" as const,
    title: "App settings",
    hint: "Look, speed, and the chosen voice.",
  },
  {
    id: "library" as const,
    title: "Library of books",
    hint: "Novels, chapters, and reading place.",
  },
  {
    id: "voices" as const,
    title: "Storyteller voices",
    hint: "Saved clips for 林华, 沈言, Clara, and Rowan.",
  },
];

export function BackupSheet({
  open,
  slots,
  onOpenChange,
  onSave,
  onSaveAll,
  onRestoreFile,
  onRestoreLast,
  onDeleteCopies,
}: {
  open: boolean;
  slots: TypedBackupSlots;
  onOpenChange: (open: boolean) => void;
  onSave: (kind: "settings" | "library" | "voices") => void;
  onSaveAll: () => void;
  onRestoreFile: () => void;
  onRestoreLast: (kind: "settings" | "library" | "voices") => void;
  onDeleteCopies: () => void;
}) {
  const showAndroid = typeof window !== "undefined" && !isIOSDevice();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent layout="sheet" className="w-[min(26rem,calc(100vw-1rem))]">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2">
          <DialogTitle className="text-lg">Save & restore</DialogTitle>
          <DialogClose
            type="button"
            aria-label="Close"
            className="inline-flex size-11 items-center justify-center rounded-lg text-ink hover:bg-paper-sunken"
          >
            <X className="size-5" />
          </DialogClose>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 [-webkit-overflow-scrolling:touch]">
          <DialogDescription>
            Save settings, books, and storyteller voices separately, or all three in one file.
          </DialogDescription>

          {showAndroid ? (
            <div className="mt-3 rounded-lg bg-paper-sunken px-3 py-3">
              <p className="font-sans text-sm font-medium text-ink">Android phone app</p>
              <p className="mt-1 font-sans text-[11px] leading-snug text-muted">
                Installs the app. Not your books. Uninstall any 1.2.0 copy first.
              </p>
              <Button
                type="button"
                className="mt-2 w-full"
                onClick={() => void openInstallFile(ANDROID_APK_HREF, ANDROID_APK_NAME)}
              >
                Download Android app {APP_VERSION_LABEL}
              </Button>
            </div>
          ) : null}

          <div className="mt-3 rounded-lg bg-paper-sunken px-3 py-2.5">
            <p className="font-sans text-sm font-medium text-ink">Save all</p>
            <p className="font-sans text-[11px] leading-snug text-muted">
              App settings, library of books, and storyteller voices in one file.
            </p>
            <Button type="button" size="sm" className="mt-2" onClick={onSaveAll}>
              Save all
            </Button>
          </div>

          <div className="mt-3 space-y-2">
            {KINDS.map((kind) => {
              const slot = slots[kind.id];
              return (
                <div key={kind.id} className="rounded-lg bg-paper-sunken px-3 py-2.5">
                  <p className="font-sans text-sm font-medium text-ink">{kind.title}</p>
                  <p className="font-sans text-[11px] leading-snug text-muted">{kind.hint}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={() => onSave(kind.id)}>
                      Save
                    </Button>
                    {slot ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => onRestoreLast(kind.id)}>
                        Restore · {formatRelativeTime(slot.savedAt)}
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <Button type="button" variant="outline" size="sm" className="mt-3 w-full" onClick={onRestoreFile}>
            Restore from a file
          </Button>
          <Button type="button" variant="ghost" size="sm" className="mt-2 w-full text-danger" onClick={onDeleteCopies}>
            Delete copies on this phone
          </Button>
        </div>

        <div className="shrink-0 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button type="button" className="w-full" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
