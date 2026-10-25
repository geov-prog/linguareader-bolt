import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { installHint, isDesktopShell, isIOSDevice } from "@/lib/browser";
import { isStandaloneDisplay } from "@/lib/pwa";

export function InstallButton() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (isStandaloneDisplay() || isDesktopShell()) {
      setInstalled(true);
      return;
    }

    const onPrompt = (event: BeforeInstallPromptEvent) => {
      event.preventDefault();
      setPromptEvent(event);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        if (promptEvent) {
          await promptEvent.prompt();
          const { outcome } = await promptEvent.userChoice;
          if (outcome === "accepted") setInstalled(true);
          setPromptEvent(null);
          return;
        }
        toast.message(isIOSDevice() ? "Add to Home Screen" : "Install LinguaReader", {
          description: installHint(),
        });
      }}
    >
      <Download className="size-3.5" />
      <span className="hidden sm:inline">Install</span>
    </Button>
  );
}
