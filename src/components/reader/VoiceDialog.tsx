import { Mic, Square, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StoredVoice } from "@/services/StorageService";
import { formatRelativeTime } from "@/lib/utils";

export function VoiceDialog({
  open,
  voices,
  phoneChoices,
  selectedId,
  onOpenChange,
  onUpload,
  onSaveRecording,
  onSelect,
  onDelete,
}: {
  open: boolean;
  voices: StoredVoice[];
  phoneChoices: { uri: string; label: string }[];
  selectedId: string | null;
  onOpenChange: (open: boolean) => void;
  onUpload: () => void;
  onSaveRecording: (blob: Blob, name: string, mime: string, offlineReadURI: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [name, setName] = useState("My voice");
  const [readWith, setReadWith] = useState("");
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stopTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!readWith && phoneChoices[0]) setReadWith(phoneChoices[0].uri);
  }, [phoneChoices, readWith]);

  useEffect(() => {
    return () => {
      if (stopTimer.current != null) window.clearTimeout(stopTimer.current);
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const stopRecording = () => {
    if (stopTimer.current != null) {
      window.clearTimeout(stopTimer.current);
      stopTimer.current = null;
    }
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  };

  const startRecording = async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser cannot record. Use Upload a voice file instead.");
      return;
    }
    if (!readWith) {
      setError("Choose the phone voice that will read books offline.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 800) {
          setError("That recording was too short. Hold the button a little longer.");
          return;
        }
        onSaveRecording(blob, name.trim() || "My voice", blob.type || "audio/webm", readWith);
        setName("My voice");
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
      stopTimer.current = window.setTimeout(stopRecording, 20_000);
    } catch {
      setError("The microphone was not allowed. You can still upload a voice file.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(36rem,calc(100vh-2rem))] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto">
        <DialogTitle>Save a voice on this phone</DialogTitle>
        <DialogDescription>
          The recording stays on this phone. Books are then read offline with the phone voice you pick
          below. It does not need the internet. It does not copy the sound of the recording onto every sentence.
        </DialogDescription>

        <label className="mt-4 block font-sans text-xs text-muted">
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 h-10 w-full rounded-md bg-paper-sunken px-3 text-sm text-ink"
          />
        </label>

        <label className="mt-3 block font-sans text-xs text-muted">
          Read books offline with
          <select
            value={readWith}
            onChange={(event) => setReadWith(event.target.value)}
            className="mt-1 h-10 w-full rounded-md bg-paper-sunken px-3 text-sm text-ink"
          >
            {phoneChoices.length === 0 ? <option value="">No phone voice yet</option> : null}
            {phoneChoices.map((choice) => (
              <option key={choice.uri} value={choice.uri}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-4 flex gap-2">
          <Button type="button" className="flex-1" onClick={() => (recording ? stopRecording() : void startRecording())}>
            {recording ? <Square className="size-4" /> : <Mic className="size-4" />}
            {recording ? "Stop and save" : "Record"}
          </Button>
          <Button type="button" variant="outline" className="flex-1" onClick={onUpload}>
            <Upload className="size-4" />
            Upload
          </Button>
        </div>
        {error ? <p className="mt-2 font-sans text-xs text-danger">{error}</p> : null}
        {recording ? <p className="mt-2 font-sans text-xs text-muted">Recording… it stops by itself after 20 seconds.</p> : null}

        <div className="mt-4 max-h-48 overflow-y-auto">
          {voices.length === 0 ? (
            <p className="rounded-lg bg-paper-sunken px-3 py-6 text-center font-sans text-sm text-muted">
              No saved voice yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {voices.map((voice) => {
                const active = voice.id === selectedId;
                return (
                  <li key={voice.id} className="flex items-center gap-2 rounded-lg bg-paper-sunken px-3 py-2">
                    <button type="button" onClick={() => onSelect(voice.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <Mic className={`size-3.5 shrink-0 ${active ? "text-pine" : "text-faint"}`} />
                      <span className="min-w-0">
                        <span className="block truncate font-sans text-sm font-medium text-ink">{voice.name}</span>
                        <span className="block font-sans text-xs text-muted">
                          {voice.offlineReadURI ? "Reads books offline" : "Plays the recording"}
                          {active ? " · Selected" : ` · ${formatRelativeTime(voice.createdAt)}`}
                        </span>
                      </span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${voice.name}`}
                      onClick={() => onDelete(voice.id)}
                    >
                      <Trash2 className="size-3.5 text-danger" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
