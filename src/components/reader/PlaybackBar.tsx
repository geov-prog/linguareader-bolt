import {
  ChevronUp,
  Gauge,
  Library,
  Locate,
  Mic,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { CUSTOM_VOICE_PREFIX, STORY_AUTO, STORY_VOICES, type SpeechState } from "@/services/SpeechManager";
import type { StoredVoice } from "@/services/StorageService";
import { androidPhoneChoices, listAndroidVoices, openAndroidVoiceDownload } from "@/services/media/AndroidVoices";
import { isAndroidChrome, isInstalledAndroidApp } from "@/utils/platform";

export function PlaybackBar({
  speech,
  voices,
  customVoices = [],
  libraryOpen = false,
  onToggleLibrary,
  onPlayPause,
  onStop,
  onSkip,
  onRate,
  onVoice,
  onUploadVoice,
  onRevealCurrent,
  autoFollow = true,
  onToggleAutoFollow,
  hideChrome = false,
  onToggleChrome,
  keepScreenOn = true,
  onToggleKeepScreen,
  collapseSignal = 0,
}: {
  speech: SpeechState;
  voices: SpeechSynthesisVoice[];
  customVoices: StoredVoice[];
  libraryOpen?: boolean;
  onToggleLibrary: () => void;
  onPlayPause: () => void;
  onStop: () => void;
  onSkip: (delta: number) => void;
  onRate: (rate: number) => void;
  onVoice: (uri: string) => void;
  onUploadVoice: () => void;
  onRevealCurrent?: () => void;
  autoFollow?: boolean;
  onToggleAutoFollow?: (on: boolean) => void;
  hideChrome?: boolean;
  onToggleChrome?: (hide: boolean) => void;
  keepScreenOn?: boolean;
  onToggleKeepScreen?: (on: boolean) => void;
  collapseSignal?: number;
}) {
  const playing = speech.status === "playing";
  const total = speech.sentences.length;
  const current = total === 0 ? 0 : speech.sentenceIndex + 1;
  const customSelected = speech.voiceURI?.startsWith(CUSTOM_VOICE_PREFIX);
  const disabled = total === 0 && !customSelected;
  const [nativePhones, setNativePhones] = useState<{ uri: string; label: string }[]>([]);
  useEffect(() => {
    if (!isInstalledAndroidApp()) return;
    void listAndroidVoices().then((list) => setNativePhones(androidPhoneChoices(list)));
  }, []);
  const phoneVoices = isInstalledAndroidApp()
    ? nativePhones
    : voices.flatMap((voice) => {
        const blob = `${voice.name} ${voice.lang} ${voice.voiceURI}`.toLowerCase();
        if (/tingting|ting-ting/.test(blob)) return [{ uri: voice.voiceURI, label: "Tingting (Chinese)" }];
        if (!isAndroidChrome() && /sinji|sin-ji/.test(blob)) return [{ uri: voice.voiceURI, label: "Sinji (Cantonese)" }];
        if (/hokkien|minnan|闽南|台语/.test(blob)) return [{ uri: voice.voiceURI, label: `${voice.name} (Hokkien)` }];
        return [];
      });
  const phoneIds = new Set(phoneVoices.map((item) => item.uri));
  const other = voices.filter((voice) => {
    if (phoneIds.has(voice.voiceURI)) return false;
    if (isAndroidChrome()) return true;
    return !/zh|cmn|yue|chinese|中文/i.test(`${voice.lang} ${voice.name} ${voice.voiceURI}`);
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    const saved = speech.voiceURI;
    const next =
      saved === "story:huayan" || saved === "piper:offline"
        ? "story:lin-hua"
        : saved === "story:lessac"
          ? "story:clara"
          : saved === "story:ryan"
            ? "story:rowan"
            : "";
    if (next) onVoice(next);
  }, [speech.voiceURI, onVoice]);
  const holdCollapsed = useRef(false);

  useEffect(() => {
    if (!collapseSignal) return;
    holdCollapsed.current = true;
    setExpanded(false);
  }, [collapseSignal]);

  useEffect(() => {
    if (holdCollapsed.current && !playing) return;
    holdCollapsed.current = false;
    setExpanded(!playing);
  }, [playing]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const sync = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      if (height > 0) {
        document.documentElement.style.setProperty("--player-bar-height", `${height}px`);
      }
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [expanded, speech.voiceStatus, speech.rolesEnabled, hideChrome]);

  return (
    <div
      ref={rootRef}
      className="lr-player pointer-events-none fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-5 xl:px-4 xl:pb-0"
    >
      <div className="lr-player-card pointer-events-auto mx-auto max-w-5xl rounded-xl bg-paper-raised/95 p-3 shadow-[var(--shadow-border-hover)] backdrop-blur-sm md:p-4 xl:max-w-none xl:rounded-b-none xl:border-t xl:border-line">
        <div className="lr-player-row flex items-center gap-2 md:gap-3">
          <Button
            variant={libraryOpen ? "outline" : "ghost"}
            size="icon-sm"
            className="md:hidden"
            onClick={onToggleLibrary}
            aria-label={libraryOpen ? "Close library" : "Open library"}
            aria-expanded={libraryOpen}
          >
            <Library className="size-4" />
          </Button>

          <Button
            variant="primary"
            size="icon"
            onClick={() => {
              setExpanded(playing);
              onPlayPause();
            }}
            disabled={disabled}
            aria-label={playing ? "Pause" : "Play"}
            className="relative"
          >
            <span
              className={cn(
                "absolute inset-0 flex items-center justify-center transition-[opacity,filter,scale] duration-[var(--motion-fast)] ease-[var(--ease-in-out)]",
                playing ? "scale-100 opacity-100 blur-none" : "scale-[0.25] opacity-0 blur-[4px]",
              )}
            >
              <Pause className="size-4" />
            </span>
            <span
              className={cn(
                "flex items-center justify-center transition-[opacity,filter,scale] duration-[var(--motion-fast)] ease-[var(--ease-in-out)]",
                playing ? "scale-[0.25] opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-none",
              )}
            >
              <Play className="size-4 ml-0.5" />
            </span>
          </Button>

          <button
            type="button"
            className="min-w-0 flex-1 pl-1 text-left"
            onClick={() => onRevealCurrent?.()}
            aria-label="Jump to the line being read"
          >
            <p className="truncate font-sans text-sm font-medium text-ink">
              {speech.title || "Select a document"}
            </p>
            <p className="truncate font-serif text-xs text-muted">
              {customSelected
                ? "Playing your recording"
                : speech.sentences[speech.sentenceIndex] || `Sentence ${current} of ${total || 0}`}
            </p>
          </button>

          {onRevealCurrent ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRevealCurrent()}
              aria-label="Jump to the line being read"
            >
              <Locate className="size-3.5" />
              Here
            </Button>
          ) : null}
          {onToggleChrome ? (
            <label className="flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-paper-sunken px-2 shadow-[var(--shadow-border)]">
              <span className="max-w-[4.5rem] font-sans text-[10px] leading-tight font-medium text-ink sm:max-w-none">
                Show/Hide Chrome
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={hideChrome}
                onChange={(e) => onToggleChrome(e.target.checked)}
                aria-label="Show or hide chrome"
                className="size-4 accent-pine"
              />
            </label>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              holdCollapsed.current = false;
              setExpanded((v) => !v);
            }}
            aria-label={expanded ? "Hide player options" : "Show player options"}
          >
            <ChevronUp className={cn("size-4 transition-transform", expanded ? "rotate-0" : "rotate-180")} />
          </Button>
        </div>

        {expanded ? (
          <>
            <div className="mt-2 flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onSkip(-1)}
                disabled={disabled}
                aria-label="Previous sentence"
              >
                <SkipBack className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onSkip(1)}
                disabled={disabled}
                aria-label="Next sentence"
              >
                <SkipForward className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onStop}
                disabled={disabled || speech.status === "idle"}
                aria-label="Stop"
              >
                <Square className="size-3.5" />
              </Button>
              <p className="min-w-0 flex-1 truncate px-2 font-sans text-xs text-muted">
                {speech.voiceStatus === "loading"
                  ? speech.voiceMessage
                  : speech.voiceStatus === "error"
                    ? speech.voiceMessage
                    : speech.currentRole
                      ? `Voice · ${speech.currentRole}`
                      : `${current} / ${total || 0}`}
              </p>
            </div>

            <div className="lr-player-tools mt-2 flex flex-col gap-3 md:flex-row md:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Gauge className="size-3.5 shrink-0 text-muted" />
                <Slider
                  min={0.6}
                  max={1.8}
                  step={0.05}
                  value={[speech.rate]}
                  onValueChange={(v) => onRate(v[0] ?? 1)}
                  aria-label="Reading rate"
                />
                <span className="w-10 shrink-0 text-right font-sans text-xs text-muted tabular-nums">
                  {speech.rate.toFixed(2).replace(/0$/, "")}×
                </span>
              </div>

              <div className="lr-voice-row flex min-w-0 items-center gap-2 md:w-[24rem]">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Voice</span>
                  <select
                    value={
                      speech.voiceURI === "story:huayan" || speech.voiceURI === "piper:offline"
                        ? "story:lin-hua"
                        : speech.voiceURI === "story:lessac"
                          ? "story:clara"
                          : speech.voiceURI === "story:ryan"
                            ? "story:rowan"
                            : speech.voiceURI || STORY_AUTO
                    }
                    onChange={(e) => onVoice(e.target.value)}
                    className="h-10 w-full min-w-0 rounded-md bg-paper-sunken px-3 font-sans text-xs text-ink shadow-[var(--shadow-border)] focus-visible:ring-2 focus-visible:ring-pine/50 focus-visible:outline-none"
                  >
                    <option value={STORY_AUTO}>Storyteller · match the page</option>
                    <optgroup label="Storytellers">
                      {STORY_VOICES.map((voice) => (
                        <option key={voice.uri} value={voice.uri}>
                          {voice.name}
                        </option>
                      ))}
                    </optgroup>
                    {customVoices.length ? (
                      <optgroup label="My voices">
                        {customVoices.map((voice) => (
                          <option key={voice.id} value={`${CUSTOM_VOICE_PREFIX}${voice.id}`}>
                            {voice.offlineReadURI ? `${voice.name} · on this phone` : voice.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {phoneVoices.length ? (
                      <optgroup label="Phone voices">
                        {phoneVoices.map(({ uri, label }) => (
                          <option key={uri} value={uri}>
                            {label}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    <optgroup label="System">
                      {other.map((voice) => (
                        <option key={voice.voiceURI} value={voice.voiceURI}>
                          {voice.name} ({voice.lang})
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </label>
                {isInstalledAndroidApp() ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void openAndroidVoiceDownload()}
                    className="shrink-0 px-2 text-[10px]"
                  >
                    Get voices
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onUploadVoice}
                  aria-label="Upload your own voice"
                  className="shrink-0"
                >
                  <Mic className="size-4" />
                </Button>
              </div>
            </div>
            {onToggleAutoFollow ? (
              <label className="mt-2 flex min-h-11 items-center justify-between gap-3 rounded-lg bg-paper-sunken px-3 py-2">
                <span className="font-sans text-xs font-medium text-ink">Auto-Follow Highlight</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={autoFollow}
                  onChange={(e) => onToggleAutoFollow(e.target.checked)}
                  aria-label="Auto-follow highlight"
                  className="size-4 accent-pine"
                />
              </label>
            ) : null}
            {onToggleKeepScreen ? (
              <label className="mt-2 flex min-h-11 items-center justify-between gap-3 rounded-lg bg-paper-sunken px-3 py-2">
                <span className="font-sans text-xs font-medium text-ink">Keep Screen On</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={keepScreenOn}
                  onChange={(e) => onToggleKeepScreen(e.target.checked)}
                  aria-label="Keep screen on"
                  className="size-4 accent-pine"
                />
              </label>
            ) : null}
            {onToggleChrome ? (
              <label className="mt-2 flex min-h-11 items-center justify-between gap-3 rounded-lg bg-paper-sunken px-3 py-2">
                <span className="font-sans text-xs font-medium text-ink">Show/Hide Chrome</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={hideChrome}
                  onChange={(e) => onToggleChrome(e.target.checked)}
                  aria-label="Show or hide chrome"
                  className="size-4 accent-pine"
                />
              </label>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
