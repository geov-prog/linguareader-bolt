import { Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { APP_VERSION_LABEL } from "@/lib/app-info";
import { ANDROID_APK_HREF, ANDROID_APK_NAME, openInstallFile } from "@/lib/downloads";

export function GetAndroidDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent layout="sheet" className="w-[min(26rem,calc(100vw-1rem))]">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Smartphone className="size-5" />
            Get the Android app
          </DialogTitle>
          <DialogClose
            type="button"
            aria-label="Close"
            className="inline-flex size-11 items-center justify-center rounded-lg text-ink hover:bg-paper-sunken"
          >
            <X className="size-5" />
          </DialogClose>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          <DialogDescription>
            This installs LinguaReader on the phone, like any other app. Your books stay on the phone.
          </DialogDescription>
          <ol className="mt-4 list-decimal space-y-2 pl-5 font-sans text-sm leading-snug text-ink">
            <li>Tap the green button. Chrome saves {ANDROID_APK_NAME}.</li>
            <li>Open that file from the download bar or the Files app.</li>
            <li>If the phone asks “allow from Chrome?”, tap Allow, then Install.</li>
          </ol>
          <p className="mt-3 font-sans text-[11px] leading-snug text-muted">
            Uninstall any old LinguaReader first if the home screen still says 1.2.0.
          </p>
        </div>
        <div className="shrink-0 space-y-2 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button
            type="button"
            className="w-full"
            onClick={() => void openInstallFile(ANDROID_APK_HREF, ANDROID_APK_NAME)}
          >
            Download Android app {APP_VERSION_LABEL}
          </Button>
          <Button type="button" variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
