import { LoaderCircle, Pause, Play, Share2, Volume2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { openRearCamera } from "@/lib/browser";
import { recognizeCanvas, warmupOcr } from "@/services/ocr/engine";
import { OCR_LANGUAGES } from "@/services/ocr/langs";
import { blobToOcrCanvas, ocrScore, videoToOcrCanvas } from "@/services/ocr/preprocess";
import { explainBilingual, formatGlossSpeech } from "@/services/ocr/gloss";
import { SpeechManager } from "@/services/SpeechManager";
import { downloadBlob } from "@/services/FileExport";

function langsFor(code: string): string[] {
  if (code === "auto") return ["eng", "chi_sim"];
  if (code === "eng") return ["eng"];
  return [code, "eng"];
}

export function ScanSheet({
  open,
  onClose,
  onSaveText,
}: {
  open: boolean;
  onClose: () => void;
  onSaveText: (text: string, title: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const running = useRef(false);
  const [status, setStatus] = useState("Point the camera at words. Hold still.");
  const [live, setLive] = useState(true);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [text, setText] = useState("");
  const [lang, setLang] = useState("auto");
  const [error, setError] = useState("");
  const [warming, setWarming] = useState(false);

  useEffect(() => {
    if (!open) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setText("");
      setPhoto(null);
      setLive(true);
      setError("");
      return;
    }
    let cancelled = false;
    setWarming(true);
    void warmupOcr(langsFor(lang), (message) => setStatus(message))
      .catch(() => {
        /* first frame will retry */
      })
      .finally(() => {
        if (!cancelled) setWarming(false);
      });
    (async () => {
      try {
        const stream = await openRearCamera();
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.setAttribute("playsinline", "true");
          await video.play();
        }
        setStatus("Point at words. They appear as you hold still.");
      } catch {
        setError("Allow the camera, or pick a photo.");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !live) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      const video = videoRef.current;
      if (video && !running.current && video.readyState >= 2) {
        running.current = true;
        try {
          const canvas = videoToOcrCanvas(video);
          if (canvas) {
            const found = await recognizeCanvas(canvas, langsFor(lang), undefined, "6");
            if (!stop && ocrScore(found) > 6) {
              setText((prev) => (ocrScore(found) >= ocrScore(prev) ? found : prev));
              setStatus("Live reading — hold still like Google Translate.");
            }
          }
        } catch (err) {
          if (!stop) setError(err instanceof Error ? err.message : "Could not read that frame.");
        } finally {
          running.current = false;
        }
      }
      if (!stop) window.setTimeout(() => void tick(), 900);
    };
    const start = window.setTimeout(() => void tick(), 500);
    return () => {
      stop = true;
      window.clearTimeout(start);
    };
  }, [open, live, lang]);

  const freezeFrame = async () => {
    const video = videoRef.current;
    const canvas = video ? videoToOcrCanvas(video) : null;
    if (!canvas) return;
    setLive(false);
    setStatus("Reading this frame…");
    canvas.toBlob((blob) => {
      if (blob) setPhoto(blob);
    }, "image/jpeg", 0.92);
    running.current = true;
    try {
      const found = await recognizeCanvas(canvas, langsFor(lang), (message) => setStatus(message), "6");
      setText(found || text);
      setStatus(found ? "Locked. Edit, listen, or save." : "No words yet — more light, or fill the frame.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that photo.");
    } finally {
      running.current = false;
    }
  };

  const onFile = async (file: File) => {
    setLive(false);
    setPhoto(file);
    setStatus("Reading photo…");
    try {
      const canvas = await blobToOcrCanvas(file);
      const found = await recognizeCanvas(canvas, langsFor(lang), (message) => setStatus(message), "6");
      setText(found);
      setStatus(found ? "Words from the photo." : "No words found in that photo.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that photo.");
    }
  };

  const sharePhoto = async () => {
    if (!photo) {
      const video = videoRef.current;
      const canvas = video ? videoToOcrCanvas(video) : null;
      if (!canvas) return;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) return;
      setPhoto(blob);
      await shareBlob(blob);
      return;
    }
    await shareBlob(photo);
  };

  const speak = () => {
    if (!text) return;
    const lines = explainBilingual(text);
    void SpeechManager.speakSnippet(formatGlossSpeech(lines) || text);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink">
      <div className="absolute inset-0">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="size-full object-cover"
        />
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-[7%] top-[16%] bottom-[38%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
        </div>
      </div>

      <div className="relative z-10 flex items-center justify-between px-3 py-3 text-pine-fg">
        <p className="font-sans text-sm">Live scan</p>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close scanner" className="text-pine-fg">
          <X className="size-4" />
        </Button>
      </div>

      <div className="relative z-10 mt-auto rounded-t-2xl bg-paper p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-ink">
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          className="h-11 w-full rounded-lg bg-paper-sunken px-3 font-sans text-sm shadow-[var(--shadow-border)]"
        >
          <option value="auto">Auto · English + 中文</option>
          {OCR_LANGUAGES.map((item) => (
            <option key={item.tess} value={item.tess}>
              {item.native}
            </option>
          ))}
        </select>
        <p className="mt-2 flex items-center gap-2 font-sans text-xs text-muted">
          {warming || (live && !text) ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
          {error || status}
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Words appear here as you point the camera."
          className="mt-2 h-28 w-full rounded-lg bg-paper-sunken p-3 font-serif text-base text-ink shadow-[var(--shadow-border)]"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="md"
            onClick={() => (live ? void freezeFrame() : setLive(true))}
            className="min-h-[var(--control-min)] flex-1"
          >
            {live ? <Pause className="size-4" /> : <Play className="size-4" />}
            {live ? "Hold this" : "Live again"}
          </Button>
          <Button variant="outline" size="md" asChild className="min-h-[var(--control-min)]">
            <label>
              Photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onFile(file);
                  e.currentTarget.value = "";
                }}
              />
            </label>
          </Button>
          <Button variant="outline" size="md" onClick={() => void sharePhoto()} className="min-h-[var(--control-min)]">
            <Share2 className="size-4" />
          </Button>
          <Button variant="outline" size="md" disabled={!text} onClick={speak} className="min-h-[var(--control-min)]">
            <Volume2 className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="md"
            disabled={!text}
            onClick={() => onSaveText(text, "Camera scan")}
            className="min-h-[var(--control-min)] flex-1"
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

async function shareBlob(blob: Blob): Promise<void> {
  const file = new File([blob], `linguareader-scan-${Date.now()}.jpg`, { type: blob.type || "image/jpeg" });
  try {
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "LinguaReader scan" });
      return;
    }
  } catch {
    /* fall through */
  }
  downloadBlob(blob, file.name);
}
