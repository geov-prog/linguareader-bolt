import { BookOpen, Moon, Palette, Search, Sun, Type } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { AppearanceSheet } from "@/components/reader/AppearanceSheet";
import { BackupSheet } from "@/components/reader/BackupSheet";
import { ConfirmDialog } from "@/components/reader/ConfirmDialog";
import { DragOverlay } from "@/components/reader/Dropzone";
import { LibraryPanel } from "@/components/reader/LibraryPanel";
import { PlaybackBar } from "@/components/reader/PlaybackBar";
import { ReaderPane, type ReaderPaneHandle } from "@/components/reader/ReaderPane";
import { RenameDialog } from "@/components/reader/RenameDialog";
import { ResumeDialog } from "@/components/reader/ResumeDialog";
import { VoiceDialog } from "@/components/reader/VoiceDialog";
import { InstallButton } from "@/components/pwa/InstallButton";
import { Button } from "@/components/ui/button";
import { nextBackupFileName } from "@/lib/backupTarget";
import { applyAppearance } from "@/lib/appearance";
import { APP_NAME, APP_VERSION_LABEL } from "@/lib/app-info";
import { isAndroidDevice } from "@/lib/browser";
import { isNativeAndroidApp } from "@/lib/downloads";
import { registerServiceWorker } from "@/lib/pwa";
import { cn } from "@/lib/utils";
import {
  AUDIO_ACCEPT,
  DOCUMENT_ACCEPT,
  FILE_INPUT_ID,
  VOICE_INPUT_ID,
  importFile,
  importVoiceFile,
  isAudioFile,
  snapshotFiles,
} from "@/services/FileImport";
import { downloadBlob, exportDocument, shareDocument, shareOrDownload, type ExportFormat } from "@/services/FileExport";
import { CUSTOM_VOICE_PREFIX, SpeechManager, type SpeechState } from "@/services/SpeechManager";
import { unlockIosAudio } from "@/services/media/SessionKeepAlive";
import { isIOS } from "@/utils/platform";
import {
  StorageService,
  type AppSettings,
  type DocumentRecord,
  type StoredVoice,
  type TypedBackupSlots,
} from "@/services/StorageService";
import { SyncService } from "@/services/SyncService";
import { unitsFromSentences } from "@/utils/sentences";
import type { ManualEncoding } from "@/utils/textNormalization";

const WALLPAPER_INPUT_ID = "lingua-open-wallpaper";
const BACKUP_INPUT_ID = "lingua-open-backup";

export function App() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [speech, setSpeech] = useState<SpeechState>(() => SpeechManager.getState());
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [customVoices, setCustomVoices] = useState<StoredVoice[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [restoreNote, setRestoreNote] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [lookOpen, setLookOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteBackupOpen, setDeleteBackupOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [hideChrome, setHideChrome] = useState(false);
  const [collapseSignal, setCollapseSignal] = useState(0);
  const [pinTopSignal, setPinTopSignal] = useState(0);
  const [keepScreenOn, setKeepScreenOn] = useState(() => {
    try {
      return localStorage.getItem("linguareader.wakeLock") !== "0";
    } catch {
      return true;
    }
  });
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const wakeWarned = useRef(false);
  const [backupSlots, setBackupSlots] = useState<TypedBackupSlots>({});
  const [lastBackupAt, setLastBackupAt] = useState<number | null>(null);
  const [revealNonce, setRevealNonce] = useState(0);
  const [scrollToActiveNonce, setScrollToActiveNonce] = useState(0);
  const [followSuspended, setFollowSuspended] = useState(false);
  const [hereQuiet, setHereQuiet] = useState(false);
  const lastUserScrollAt = useRef(0);
  const pausedAtIndex = useRef(0);
  const playingRef = useRef(false);
  const [resumeOffer, setResumeOffer] = useState<{
    documentId: string;
    title: string;
    percent: number;
  } | null>(null);
  const readerRef = useRef<ReaderPaneHandle>(null);
  const dragDepth = useRef(0);
  const settingsRef = useRef<AppSettings | null>(null);
  const wallpaperUrlRef = useRef<string | null>(null);
  const hideChromeRef = useRef(false);
  settingsRef.current = settings;
  hideChromeRef.current = hideChrome;

  const paintLook = useCallback((next: AppSettings, wallpaperUrl?: string | null) => {
    if (wallpaperUrl !== undefined) wallpaperUrlRef.current = wallpaperUrl;
    applyAppearance({
      theme: next.theme,
      fontFamily: next.fontFamily,
      accent: next.accent,
      wallpaper: next.wallpaper,
      controlSize: next.controlSize,
      focusMode: hideChromeRef.current,
      hand: next.hand,
      wallpaperUrl: wallpaperUrlRef.current,
    });
  }, []);

  const activeDoc = useMemo(
    () => documents.find((doc) => doc.id === activeId) ?? null,
    [documents, activeId],
  );
  const renameDoc = documents.find((doc) => doc.id === renameId) ?? null;

  const refreshLibrary = useCallback(async () => {
    const docs = await StorageService.listDocuments();
    setDocuments(docs);
    const meta = await StorageService.getLastBackupMeta();
    setLastBackupAt(meta?.savedAt ?? null);
    setBackupSlots(await StorageService.getTypedBackupSlots());
    return docs;
  }, []);

  const patchSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const current = settingsRef.current;
    if (current) {
      const optimistic = { ...current, ...patch };
      settingsRef.current = optimistic;
      setSettings(optimistic);
      paintLook(optimistic);
    }
    const next = await StorageService.saveSettings(patch);
    settingsRef.current = next;
    setSettings(next);
    paintLook(next);
    return next;
  }, [paintLook]);

  const selectDocument = useCallback(
    async (id: string, stored?: AppSettings | null) => {
      const saved = await StorageService.getDocument(id);
      if (!saved) return;
      const local = StorageService.readLocalResume();
      const storedOffset = await StorageService.getProgressOffset(id);
      const localOffset = local?.documentId === id ? local.sentenceOffset : 0;
      const offset = Math.max(saved.sentenceOffset, storedOffset, localOffset);
      await StorageService.markBookOpened(id);
      const opened = await StorageService.listDocuments();
      setDocuments(opened);
      setActiveId(id);
      await StorageService.saveSettings({ lastActiveId: id });
      const fresh = opened.find((item) => item.id === id) ?? saved;
      await SpeechManager.loadDocument({ ...fresh, sentenceOffset: Math.max(fresh.sentenceOffset, offset) }, stored ?? undefined);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await StorageService.seedIfEmpty();
        await StorageService.clearStaleTtsCache();
        const [docs, stored, uploaded, backupMeta, slots] = await Promise.all([
          StorageService.listDocuments(),
          StorageService.getSettings(),
          StorageService.listVoicesStored(),
          StorageService.getLastBackupMeta(),
          StorageService.getTypedBackupSlots(),
        ]);
        if (cancelled) return;
        setDocuments(docs);
        setSettings(stored);
        setLastBackupAt(backupMeta?.savedAt ?? null);
        setBackupSlots(slots);
        setCustomVoices(uploaded);
        const resume = await StorageService.getResumeSnapshot();
        const initial =
          resume?.documentId && docs.some((d) => d.id === resume.documentId)
            ? resume.documentId
            : stored.lastActiveId && docs.some((d) => d.id === stored.lastActiveId)
              ? stored.lastActiveId
              : (docs[0]?.id ?? null);
        setActiveId(initial);
        SpeechManager.applySettings({
          rate: stored.rate,
          pitch: stored.pitch,
          voiceURI: stored.voiceURI,
          rolesEnabled: stored.rolesEnabled,
        });
        if (initial) {
          const doc = docs.find((d) => d.id === initial);
          if (doc) {
            await SpeechManager.loadDocument(doc, stored);
            const count = Math.max(1, doc.sentenceCount);
            const percent = Math.round((doc.sentenceOffset / count) * 100);
            if (doc.sentenceOffset > 1 && percent > 0 && percent < 100) {
              setResumeOffer({
                documentId: doc.id,
                title: doc.title,
                percent: Math.min(99, Math.max(1, percent)),
              });
            }
          }
        } else {
          SpeechManager.stop();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not open the local library.";
        if (/lower version|VersionError/i.test(message)) {
          toast.error("This phone has a newer library copy. Close other LinguaReader tabs, then refresh.");
        } else {
          toast.error(message);
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return SpeechManager.subscribe(setSpeech);
  }, []);

  useEffect(() => {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const nav = window.navigator as Navigator & { standalone?: boolean };
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
    if (isIOS && isStandalone) document.documentElement.classList.add("ios-pwa-standalone");
    else document.documentElement.classList.remove("ios-pwa-standalone");
  }, []);

  useEffect(() => {
    let cancelled = false;
    const release = () => {
      const lock = wakeLockRef.current;
      wakeLockRef.current = null;
      if (!lock) return;
      void lock.release().catch(() => undefined);
    };
    const playing = speech.status === "playing" && keepScreenOn;
    if (!playing) {
      release();
      return;
    }
    const ask = () => {
      const locks = navigator.wakeLock;
      if (!locks?.request) {
        if (!wakeWarned.current) {
          wakeWarned.current = true;
          toast("Screen wake lock not supported on this device.");
        }
        return;
      }
      void locks
        .request("screen")
        .then((sentinel) => {
          if (cancelled || speech.status !== "playing" || !keepScreenOn) {
            void sentinel.release().catch(() => undefined);
            return;
          }
          wakeLockRef.current = sentinel;
        })
        .catch(() => {
          if (cancelled || wakeWarned.current) return;
          wakeWarned.current = true;
          toast("Screen wake lock not supported on this device.");
        });
    };
    ask();
    const onVisible = () => {
      if (document.visibilityState === "visible") ask();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      release();
    };
  }, [speech.status, keepScreenOn]);

  useEffect(() => {
    playingRef.current = speech.status === "playing";
  }, [speech.status, activeId]);

  useEffect(() => {
    void registerServiceWorker();
  }, []);

  useEffect(() => {
    void SpeechManager.waitForVoices().then(setVoices);
    const onVoices = () => setVoices(SpeechManager.listVoices());
    window.speechSynthesis?.addEventListener?.("voiceschanged", onVoices);
    const onShow = () => {
      if (document.visibilityState === "visible") setVoices(SpeechManager.listVoices());
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.speechSynthesis?.removeEventListener?.("voiceschanged", onVoices);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);

  useEffect(() => {
    if (!settings) return;
    paintLook(settings);
    if (settings.wallpaper !== "custom" || wallpaperUrlRef.current) return;
    let alive = true;
    void StorageService.getWallpaper().then((blob) => {
      if (!alive || !blob) return;
      const url = URL.createObjectURL(blob);
      paintLook(settings, url);
    });
    return () => {
      alive = false;
    };
  }, [settings, hideChrome, paintLook]);

  useEffect(() => {
    return SyncService.subscribe((event) => {
      if (event.type === "library" || event.type === "progress") void refreshLibrary();
      if (event.type === "settings") {
        void StorageService.getSettings().then(setSettings);
      }
    });
  }, [refreshLibrary]);

  const ingestFiles = useCallback(
    async (list: FileList | File[] | null) => {
      if (!list || list.length === 0) return;
      const incoming = Array.from(list);
      const loadingBook = incoming.some((file) => !isAudioFile(file));
      if (loadingBook) {
        setImporting(true);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      try {
        const files = await snapshotFiles(incoming);
        for (const file of files) {
          try {
            if (isAudioFile(file)) {
              const voice = await importVoiceFile(file);
              await refreshLibrary();
              setCustomVoices(await StorageService.listVoicesStored());
              toast.success(`Added voice “${voice.name}”.`);
              continue;
            }
            const result = await importFile(file);
            if (result.kind === "backup") {
              const docs = await refreshLibrary();
              toast.success(`Restored ${result.count} items.`);
              if (docs[0]) await selectDocument(docs[0].id);
              continue;
            }
            const docs = await refreshLibrary();
            const last = result.documents.at(-1);
            if (last) await selectDocument(last.id);
            toast.success(`Opened ${result.formatLabel} · ${result.encoding}`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not open that file.");
          }
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not open that file.");
      } finally {
        if (loadingBook) setImporting(false);
      }
    },
    [refreshLibrary, selectDocument],
  );

  const applyTypedRestore = useCallback(
    async (result: { kind: string; count: number; label: string }) => {
      const stored = await StorageService.getSettings();
      setSettings(stored);
      SpeechManager.applySettings({
        rate: stored.rate,
        pitch: stored.pitch,
        voiceURI: stored.voiceURI,
        rolesEnabled: stored.rolesEnabled,
      });
      const docs = await refreshLibrary();
      if (result.kind === "library" || result.kind === "full") {
        const next = stored.lastActiveId && docs.some((d) => d.id === stored.lastActiveId) ? stored.lastActiveId : docs[0]?.id;
        if (next) await selectDocument(next, stored);
      }
      toast.success(
        result.kind === "settings"
          ? "Settings restored."
          : result.kind === "library"
            ? `Restored ${result.count} books, including their chapters.`
            : result.kind === "voices"
              ? `Restored ${result.count} storyteller clips.`
              : result.kind === "mix-pack"
                ? "Mix packs are no longer used. Books and settings were left as they are."
                : `Restored ${result.count} items.`,
      );
    },
    [refreshLibrary, selectDocument],
  );

  const saveEverything = useCallback(async () => {
    try {
      const { blob } = await StorageService.exportBackup();
      const filename = nextBackupFileName("ful");
      await shareOrDownload(blob, filename);
      toast.success(`Saved as ${filename}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save everything.");
    }
  }, []);

  const saveTypedBackup = useCallback(async (kind: "settings" | "library" | "voices") => {
    try {
      let filename = "";
      if (kind === "settings") {
        const blob = await StorageService.exportSettingsBackup();
        filename = nextBackupFileName("set");
        await shareOrDownload(blob, filename);
        await StorageService.rememberTypedBackup(kind, blob, filename);
      } else if (kind === "library") {
        const { blob } = await StorageService.exportLibraryBackup();
        filename = nextBackupFileName("jrn");
        await shareOrDownload(blob, filename);
        await StorageService.rememberTypedBackup(kind, blob, filename);
      } else {
        const blob = await StorageService.exportVoicesBackup();
        filename = nextBackupFileName("voc");
        await shareOrDownload(blob, filename);
        await StorageService.rememberTypedBackup(kind, blob, filename);
      }
      setBackupSlots(await StorageService.getTypedBackupSlots());
      toast.success(
        kind === "settings"
          ? `Settings saved as ${filename}`
          : kind === "library"
            ? `Library saved as ${filename}`
            : `Voices saved as ${filename}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that backup.");
    }
  }, []);

  const onPlayPause = useCallback(() => {
    if (!activeDoc) return;
    if (!(isIOS() && SpeechManager.usesSystemVoice())) unlockIosAudio();
    if (speech.status === "playing") {
      SpeechManager.pause();
      return;
    }
    SpeechManager.primeFromGesture();
    if (speech.status === "paused") {
      SpeechManager.resume();
      return;
    }
    void SpeechManager.play(activeDoc);
  }, [activeDoc, speech.status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        readerRef.current?.openFind();
        return;
      }
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        onPlayPause();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        void SpeechManager.skip(-1);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        void SpeechManager.skip(1);
      } else if (e.code === "Escape") {
        SpeechManager.stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPlayPause]);

  const sentences = speech.documentId === activeDoc?.id ? speech.sentences : [];
  const autoFollow = settings?.autoFollowHighlight !== false;
  const followLive = autoFollow && !followSuspended && !hereQuiet;

  useEffect(() => SpeechManager.subscribeScrollToActive(setScrollToActiveNonce), []);

  useEffect(() => {
    if (!autoFollow || !followSuspended) return;
    const from = pausedAtIndex.current;
    const to = speech.sentenceIndex;
    const units = sentences.length ? unitsFromSentences(sentences) : [];
    const crossed = to > from && units.slice(from + 1, to + 1).some((unit) => unit.para);
    const remaining = 2500 - (Date.now() - lastUserScrollAt.current);
    if (crossed && remaining <= 0) {
      setFollowSuspended(false);
      return;
    }
    const timer = window.setTimeout(() => {
      const now = SpeechManager.getState().sentenceIndex;
      const nowUnits = sentences.length ? unitsFromSentences(sentences) : [];
      const nowCrossed = now > from && nowUnits.slice(from + 1, now + 1).some((unit) => unit.para);
      if (nowCrossed && Date.now() - lastUserScrollAt.current >= 2500) {
        setFollowSuspended(false);
      }
    }, Math.max(80, remaining));
    return () => window.clearTimeout(timer);
  }, [autoFollow, followSuspended, speech.sentenceIndex, sentences]);

  return (
    <div
      className="app-content-wrapper flex h-svh flex-col overflow-hidden text-ink"
      data-app-shell=""
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        void ingestFiles(e.dataTransfer.files);
      }}
    >
      <header data-chrome="header" className="sticky top-0 z-30 flex shrink-0 items-center gap-2 border-b border-line bg-paper/90 px-3 py-2 backdrop-blur-sm md:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-full bg-pine text-paper">
            <BookOpen className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-lg leading-none">{APP_NAME}</p>
            <p className="truncate font-sans text-[10px] text-muted">
              {APP_VERSION_LABEL} · Works in Chrome, Safari, Firefox, and Edge
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => readerRef.current?.openFind()} aria-label="Find">
          <Search className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            const next = settings?.fontSize ? Math.min(32, settings.fontSize + 1) : 20;
            void patchSettings({ fontSize: next });
          }}
          aria-label="Larger text"
        >
          <Type className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void patchSettings({ theme: settings?.theme === "night" ? "paper" : "night" })}
          aria-label="Toggle night mode"
        >
          {settings?.theme === "night" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => setLookOpen(true)} aria-label="Look and reach">
          <Palette className="size-4" />
        </Button>
        {isNativeAndroidApp() || isAndroidDevice() ? null : <InstallButton />}
        <Button
          variant={libraryOpen ? "primary" : "outline"}
          size="sm"
          onClick={() => setLibraryOpen((open) => !open)}
          aria-expanded={libraryOpen}
        >
          {libraryOpen ? "Close" : "Library"}
        </Button>
      </header>

      <div className="lr-shell mx-auto grid min-h-0 w-full max-w-6xl flex-1 overflow-hidden md:grid-cols-[18rem_minmax(0,1fr)] xl:max-w-none xl:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
        <aside
          className={cn(
            "border-line bg-paper md:sticky md:top-[var(--app-header)] md:block md:h-[calc(100dvh-var(--app-header))] md:border-r",
            libraryOpen ? "fixed inset-0 z-40 h-dvh pb-[var(--player-clearance,6.5rem)] md:static md:pb-0" : "hidden",
          )}
        >
          <LibraryPanel
            documents={documents}
            activeId={activeId}
            hydrated={hydrated}
            lastBackupAt={lastBackupAt}
            onSelect={(id) => {
              void selectDocument(id);
              setLibraryOpen(false);
            }}
            onDelete={(id) => setDeleteId(id)}
            onRename={(id) => setRenameId(id)}
            onShare={(id) => {
              const doc = documents.find((item) => item.id === id);
              if (doc) void shareDocument(doc).then((how) => toast.success(how === "shared" ? "Shared." : "Copied."));
            }}
            onSaveBook={(id) => {
              const doc = documents.find((item) => item.id === id);
              if (doc) {
                void exportDocument(doc, "txt").then(({ blob, filename }) => downloadBlob(blob, filename));
              }
            }}
            onImportClick={() => document.getElementById(FILE_INPUT_ID)?.click()}
            onOpenBackup={() => setBackupOpen(true)}
            onJumpChapter={(id, index) => {
              void (async () => {
                if (id !== activeId) await selectDocument(id);
                await SpeechManager.jumpTo(index, speech.status === "playing");
                SpeechManager.triggerScrollToActive();
                window.scrollTo(0, 0);
              })();
            }}
            readingIndex={speech.status === "playing" && speech.documentId === activeId ? speech.sentenceIndex : null}
            readingLive={speech.status === "playing" && speech.documentId === activeId}
            onClose={() => setLibraryOpen(false)}
          />
        </aside>

        <main className="lr-reader-main min-h-0 min-w-0 overflow-hidden px-3 pb-[var(--player-clearance)] pt-2 md:px-6 xl:px-10">
          {activeDoc ? (
            <ReaderPane
              ref={readerRef}
              document={activeDoc}
              sentences={sentences.length ? sentences : SpeechManager.splitSentences(activeDoc.rawText)}
              activeIndex={speech.documentId === activeDoc.id ? speech.sentenceIndex : activeDoc.sentenceOffset}
              fontSize={settings?.fontSize ?? 19}
              hydrated={hydrated}
              preparing={!hydrated}
              followPlayback={followLive}
              revealNonce={revealNonce}
              pinTopSignal={pinTopSignal}
              scrollToActiveNonce={scrollToActiveNonce}
              onFollowLive={(on) => {
                if (on) {
                  setFollowSuspended(false);
                  return;
                }
                lastUserScrollAt.current = Date.now();
                pausedAtIndex.current = speech.sentenceIndex;
                setFollowSuspended(true);
              }}
              onJump={(index) => void SpeechManager.jumpTo(index, speech.status === "playing")}
              onSave={(format: ExportFormat) => {
                void exportDocument(activeDoc, format).then(({ blob, filename }) => downloadBlob(blob, filename));
              }}
              onEncoding={async (encoding: ManualEncoding) => {
                try {
                  const next = await StorageService.redecodeDocument(activeDoc.id, encoding);
                  await refreshLibrary();
                  await selectDocument(next.id);
                  toast.success(`Showing ${encoding.toUpperCase()}.`);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Could not apply that encoding.");
                }
              }}
              onRename={() => setRenameId(activeDoc.id)}
              onShare={() => {
                void shareDocument(activeDoc).then((how) => toast.success(how === "shared" ? "Shared." : "Saved a copy."));
              }}
              onDelete={() => setDeleteId(activeDoc.id)}
              onSaveText={async (text) => {
                await StorageService.updateDocumentText(activeDoc.id, text);
                await refreshLibrary();
                await selectDocument(activeDoc.id);
                toast.success("Page saved.");
              }}
            />
          ) : (
            <div className="py-16 text-center">
              <p className="font-display text-2xl">A private library</p>
              <p className="mt-2 font-sans text-sm text-muted">Add a novel to begin.</p>
              <Button className="mt-6" onClick={() => document.getElementById(FILE_INPUT_ID)?.click()}>
                Open a file
              </Button>
            </div>
          )}
        </main>
        {hydrated ? (
          <PlaybackBar
            speech={speech}
            voices={voices}
            customVoices={customVoices}
            onToggleLibrary={() => setLibraryOpen((open) => !open)}
            libraryOpen={libraryOpen}
            onRevealCurrent={() => {
              setHereQuiet(true);
              window.setTimeout(() => setHereQuiet(false), 1000);
              SpeechManager.triggerScrollToActive();
            }}
            autoFollow={autoFollow}
            onToggleAutoFollow={(on) => {
              setFollowSuspended(false);
              void patchSettings({ autoFollowHighlight: on });
            }}
            hideChrome={hideChrome}
            onToggleChrome={setHideChrome}
            keepScreenOn={keepScreenOn}
            onToggleKeepScreen={(on) => {
              setKeepScreenOn(on);
              try {
                localStorage.setItem("linguareader.wakeLock", on ? "1" : "0");
              } catch {
                /* the switch still works for this visit */
              }
            }}
            collapseSignal={collapseSignal}
            onPlayPause={onPlayPause}
            onStop={() => SpeechManager.stop()}
            onSkip={(d) => void SpeechManager.skip(d)}
            onRate={(rate) => SpeechManager.setRate(rate)}
            onVoice={(uri) => SpeechManager.setVoice(uri || null)}
            onUploadVoice={() => setVoiceOpen(true)}
          />
        ) : null}
      </div>

      <DragOverlay active={dragging} />
      {importing || restoreNote ? (
        typeof document !== "undefined" ? (
          createPortal(
            <div className="lr-book-loading" role="status" aria-live="polite">
              <div className="lr-book-loading-card">
                {restoreNote ? <span className="lr-spin" aria-hidden="true" /> : null}
                {restoreNote ?? "Book loading"}
              </div>
            </div>,
            document.body,
          )
        ) : null
      ) : null}

      <input
        id={FILE_INPUT_ID}
        type="file"
        accept={DOCUMENT_ACCEPT}
        className="sr-only"
        multiple
        onChange={(e) => {
          void ingestFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        id={VOICE_INPUT_ID}
        type="file"
        accept={AUDIO_ACCEPT}
        className="sr-only"
        onChange={(e) => {
          void ingestFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        id={BACKUP_INPUT_ID}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const mb = Math.max(1, Math.round(file.size / (1024 * 1024)));
          setRestoreNote(file.size >= 1024 * 1024 ? `Restoring ${mb}MB backup...` : "Restoring backup...");
          await new Promise((resolve) => setTimeout(resolve, 50));
          try {
            const result = await StorageService.importTypedBackupBuffer(await file.arrayBuffer());
            await applyTypedRestore(result);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not restore that backup.");
          } finally {
            setRestoreNote(null);
          }
        }}
      />
      <input
        id={WALLPAPER_INPUT_ID}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const url = URL.createObjectURL(file);
          if (wallpaperUrlRef.current) URL.revokeObjectURL(wallpaperUrlRef.current);
          const current = settingsRef.current;
          if (current) paintLook({ ...current, wallpaper: "custom" }, url);
          await StorageService.putWallpaper(file);
          await patchSettings({ wallpaper: "custom" });
          toast.success("Wallpaper saved on this phone.");
        }}
      />

      <RenameDialog
        open={!!renameDoc}
        title={renameDoc?.title ?? ""}
        onOpenChange={(open) => {
          if (!open) setRenameId(null);
        }}
        onSave={async (title) => {
          if (!renameDoc) return;
          await StorageService.renameDocument(renameDoc.id, title);
          await refreshLibrary();
          setRenameId(null);
          toast.success("Renamed.");
        }}
      />
      <ConfirmDialog
        open={!!deleteId}
        title="Delete this book?"
        description="It is only removed from this phone."
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        onConfirm={async () => {
          if (!deleteId) return;
          await StorageService.deleteDocument(deleteId);
          const docs = await refreshLibrary();
          setDeleteId(null);
          if (activeId === deleteId) {
            const next = docs[0];
            if (next) await selectDocument(next.id);
            else {
              setActiveId(null);
              SpeechManager.stop();
            }
          }
        }}
      />
      <ConfirmDialog
        open={deleteBackupOpen}
        title="Delete copies on this phone?"
        description="This removes the last saved settings, books, and voice files stored here. Your open library stays. Files you already saved to iCloud are not touched."
        confirmLabel="Delete copies"
        onOpenChange={setDeleteBackupOpen}
        onConfirm={async () => {
          await StorageService.clearTypedBackups();
          setLastBackupAt(null);
          setBackupSlots({});
          setDeleteBackupOpen(false);
          toast.success("Saved copies removed from this phone.");
        }}
      />
      <BackupSheet
        open={backupOpen}
        slots={backupSlots}
        onOpenChange={setBackupOpen}
        onSave={(kind) => void saveTypedBackup(kind)}
        onSaveAll={() => void saveEverything()}
        onRestoreFile={() => document.getElementById(BACKUP_INPUT_ID)?.click()}
        onRestoreLast={async (kind) => {
          setRestoreNote("Restoring backup...");
          await new Promise((resolve) => setTimeout(resolve, 50));
          try {
            const result = await StorageService.restoreTypedBackup(kind);
            if (!result) {
              toast.error("No saved copy of that kind on this phone yet.");
              return;
            }
            await applyTypedRestore(result);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not restore that copy.");
          } finally {
            setRestoreNote(null);
          }
        }}
        onDeleteCopies={() => setDeleteBackupOpen(true)}
      />
      <ResumeDialog
        open={!!resumeOffer}
        title={resumeOffer?.title ?? ""}
        percent={resumeOffer?.percent ?? 0}
        onOpenChange={(open) => {
          if (!open) setResumeOffer(null);
        }}
        onContinue={() => {
          setHideChrome(true);
          setCollapseSignal((n) => n + 1);
          setPinTopSignal((n) => n + 1);
          SpeechManager.triggerScrollToActive();
          setResumeOffer(null);
        }}
        onRestart={() => {
          if (resumeOffer) void SpeechManager.jumpTo(0);
          setHideChrome(true);
          setCollapseSignal((n) => n + 1);
          setPinTopSignal((n) => n + 1);
          SpeechManager.triggerScrollToActive();
          setResumeOffer(null);
        }}
      />
      <VoiceDialog
        open={voiceOpen}
        voices={customVoices}
        phoneChoices={voices.map((voice) => ({ uri: voice.voiceURI, label: `${voice.name} (${voice.lang})` }))}
        selectedId={speech.voiceURI?.startsWith(CUSTOM_VOICE_PREFIX) ? speech.voiceURI.slice(CUSTOM_VOICE_PREFIX.length) : null}
        onOpenChange={setVoiceOpen}
        onUpload={() => document.getElementById(VOICE_INPUT_ID)?.click()}
        onSaveRecording={(blob, name, mime, offlineReadURI) => {
          const id = crypto.randomUUID();
          void StorageService.putVoice({
            id,
            name,
            mime,
            blob,
            createdAt: Date.now(),
            offlineReadURI,
          }).then(async () => {
            setCustomVoices(await StorageService.listVoicesStored());
            SpeechManager.setVoice(`${CUSTOM_VOICE_PREFIX}${id}`);
            setVoiceOpen(false);
            toast.success(`Saved “${name}” on this phone. Play reads the book with no internet.`);
          });
        }}
        onSelect={(id) => {
          SpeechManager.setVoice(`${CUSTOM_VOICE_PREFIX}${id}`);
          setVoiceOpen(false);
        }}
        onDelete={async (id) => {
          await StorageService.deleteVoice(id);
          setCustomVoices(await StorageService.listVoicesStored());
        }}
      />
      {settings ? (
        <AppearanceSheet
          open={lookOpen}
          settings={settings}
          onOpenChange={setLookOpen}
          onPatch={(patch) => void patchSettings(patch)}
          onUploadWallpaper={() => document.getElementById(WALLPAPER_INPUT_ID)?.click()}
          onClearVoiceCache={() => {
            void StorageService.clearTtsCache().then(() => toast.success("Saved voices cleared from this phone."));
          }}
        />
      ) : null}
    </div>
  );
}
