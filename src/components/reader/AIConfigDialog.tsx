import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { AiProvider, AppSettings } from "@/services/StorageService";

const PROVIDERS: { id: AiProvider; label: string; hint: string; href?: string; models: string[] }[] = [
  {
    id: "none",
    label: "Off",
    hint: "Do not use an assistant.",
    models: [],
  },
  {
    id: "google",
    label: "Google AI Studio",
    hint: "Gemini Flash-Lite. About 1,500 free requests a day. No credit card.",
    href: "https://aistudio.google.com/apikey",
    models: ["gemini-2.5-flash-lite", "gemini-2.0-flash"],
  },
  {
    id: "groq",
    label: "Groq",
    hint: "Llama 3.3 and Llama 3.1. Very fast. Free key from Groq Console. No credit card.",
    href: "https://console.groq.com/keys",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  },
  {
    id: "grok",
    label: "xAI Grok",
    hint: "Optional. Uses a paid xAI key if you already have one.",
    href: "https://console.x.ai/",
    models: ["grok-3-mini", "grok-3"],
  },
];

export function AIConfigDialog({
  open,
  settings,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  settings: AppSettings | null;
  onOpenChange: (open: boolean) => void;
  onSave: (patch: Pick<AppSettings, "aiProvider" | "aiApiKey" | "aiSelectedModel">) => void;
}) {
  const [provider, setProvider] = useState<AiProvider>("none");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");

  useEffect(() => {
    if (!open || !settings) return;
    setProvider(settings.aiProvider || "none");
    setApiKey(settings.aiApiKey || "");
    setModel(settings.aiSelectedModel || "");
  }, [open, settings]);

  const chosen = PROVIDERS.find((item) => item.id === provider) ?? PROVIDERS[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent layout="sheet" className="w-[min(28rem,calc(100vw-1rem))]">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 [-webkit-overflow-scrolling:touch]">
          <DialogTitle>Free AI helper</DialogTitle>
          <DialogDescription className="mt-1">
            The key stays on this phone or computer. It is saved with your look settings and is not sent to LinguaReader’s servers.
          </DialogDescription>

          <label className="mt-4 block">
            <span className="font-sans text-xs font-medium text-ink">Provider</span>
            <select
              value={provider}
              onChange={(e) => {
                const next = e.target.value as AiProvider;
                setProvider(next);
                const models = PROVIDERS.find((item) => item.id === next)?.models ?? [];
                setModel(models[0] ?? "");
              }}
              className="mt-1 h-11 w-full rounded-md bg-paper-sunken px-3 font-sans text-sm text-ink"
            >
              {PROVIDERS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-2 font-sans text-[12px] leading-snug text-muted">{chosen.hint}</p>
          {chosen.href ? (
            <a
              href={chosen.href}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block font-sans text-xs font-medium text-pine underline"
            >
              Open the free key page
            </a>
          ) : null}

          {provider !== "none" ? (
            <>
              <label className="mt-4 block">
                <span className="font-sans text-xs font-medium text-ink">API key</span>
                <Input
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste the key here"
                  className="mt-1"
                />
              </label>
              <label className="mt-3 block">
                <span className="font-sans text-xs font-medium text-ink">Model</span>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="mt-1 h-11 w-full rounded-md bg-paper-sunken px-3 font-sans text-sm text-ink"
                >
                  {chosen.models.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}

          <div className="mt-5 flex justify-end gap-2 pb-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() =>
                onSave({
                  aiProvider: provider,
                  aiApiKey: provider === "none" ? "" : apiKey.trim(),
                  aiSelectedModel: provider === "none" ? "" : model,
                })
              }
            >
              Save on this device
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
