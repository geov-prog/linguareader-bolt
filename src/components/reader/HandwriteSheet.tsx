import { Eraser, Volume2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { recognizeImage } from "@/services/ocr/engine";
import { OCR_LANGUAGES } from "@/services/ocr/langs";
import { explainBilingual, formatGlossSpeech, type GlossLine } from "@/services/ocr/gloss";
import { SpeechManager } from "@/services/SpeechManager";

export function HandwriteSheet({
  open,
  onClose,
  onSaveText,
}: {
  open: boolean;
  onClose: () => void;
  onSaveText: (text: string, title: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [lang, setLang] = useState("chi_sim");
  const [status, setStatus] = useState("Write a word with your finger.");
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<GlossLine[]>([]);
  const [text, setText] = useState("");

  const resize = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#faf6ef";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#1c1915";
    ctx.lineWidth = 14 * dpr;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  };

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(resize);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", resize);
    };
  }, [open]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    return {
      x: (event.clientX - rect.left) * dpr,
      y: (event.clientY - rect.top) * dpr,
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = point(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const clearPad = () => {
    resize();
    setText("");
    setLines([]);
    setStatus("Write a word with your finger.");
  };

  const recognize = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setBusy(true);
    setStatus("Reading your handwriting… language pack downloads once.");
    try {
      const tess = lang === "eng" ? ["eng"] : [lang, "eng"];
      const found = await recognizeImage(canvas, tess, (message, pct) => setStatus(`${message} ${pct}%`));
      setText(found);
      const gloss = explainBilingual(found);
      setLines(gloss);
      setStatus(found ? "Identified." : "Could not read that. Write larger, then try again.");
      if (found) void SpeechManager.speakSnippet(formatGlossSpeech(gloss) || found);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not read the writing.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper text-ink">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="font-sans text-sm">Write to read</p>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close handwriting">
          <X className="size-4" />
        </Button>
      </div>
      <p className="px-4 pb-2 font-sans text-xs text-muted">
        Scribble a character or a short word. Chinese includes 汉语拼音 and English. Other languages read aloud and pair with English.
      </p>
      <canvas
        ref={canvasRef}
        className="mx-4 min-h-0 flex-1 touch-none rounded-xl bg-paper-raised shadow-[var(--shadow-border)]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          drawing.current = false;
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />
      <div className="space-y-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          className="h-11 w-full rounded-lg bg-paper-sunken px-3 font-sans text-sm shadow-[var(--shadow-border)]"
        >
          {OCR_LANGUAGES.map((item) => (
            <option key={item.tess} value={item.tess}>
              {item.native}
            </option>
          ))}
        </select>
        <p className="font-sans text-xs text-muted">{status}</p>
        {lines.length ? (
          <ul className="max-h-36 space-y-1 overflow-y-auto rounded-lg bg-paper-sunken p-3">
            {lines.map((line, i) => (
              <li key={`${line.original}-${i}`} className="font-sans text-sm">
                <span className="font-serif text-lg text-ink">{line.original}</span>
                {line.pinyin ? <span className="ml-2 text-pine">{line.pinyin}</span> : null}
                <span className="ml-2 text-muted">{line.english}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={clearPad} className="min-h-[var(--control-min)]">
            <Eraser className="size-4" />
            Clear
          </Button>
          <Button onClick={() => void recognize()} disabled={busy} className="min-h-[var(--control-min)] flex-1">
            Read this
          </Button>
          <Button variant="outline" disabled={!text} onClick={() => void SpeechManager.speakSnippet(formatGlossSpeech(lines) || text)} className="min-h-[var(--control-min)]">
            <Volume2 className="size-4" />
          </Button>
          <Button variant="outline" disabled={!text} onClick={() => onSaveText(text, "Handwriting")} className="min-h-[var(--control-min)]">
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
