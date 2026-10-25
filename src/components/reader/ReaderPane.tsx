import { Locate, MoreHorizontal, Pencil, Search, Share2, Trash2 } from "lucide-react";
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { FindBar, HighlightedText } from "@/components/reader/FindBar";
import { SaveMenu } from "@/components/reader/SaveMenu";
import { followInContainer, revealInContainer, VirtualPassage } from "@/components/reader/VirtualPassage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatCount } from "@/lib/utils";
import type { ExportFormat } from "@/services/FileExport";
import type { DocumentRecord } from "@/services/StorageService";
import { findInSentences } from "@/utils/search";
import { readingProgress, unitsFromSentences, type ReadingUnit } from "@/utils/sentences";
import { MANUAL_ENCODINGS, type ManualEncoding } from "@/utils/textNormalization";

export type ReaderPaneHandle = {
  openFind: () => void;
  revealCurrent: () => void;
};

const EDIT_LIMIT = 120_000;
const VIRTUALIZE_AFTER = 80;

export function ReaderPane({
  document: doc,
  sentences,
  activeIndex,
  fontSize,
  hydrated = true,
  preparing = false,
  followPlayback = false,
  revealNonce = 0,
  pinTopSignal = 0,
  scrollToActiveNonce = 0,
  ref,
  onJump,
  onFollowLive,
  onSave,
  onEncoding,
  onRename,
  onShare,
  onDelete,
  onSaveText,
}: {
  document: DocumentRecord;
  sentences: string[];
  activeIndex: number;
  fontSize: number;
  hydrated?: boolean;
  preparing?: boolean;
  followPlayback?: boolean;
  revealNonce?: number;
  pinTopSignal?: number;
  scrollToActiveNonce?: number;
  ref?: Ref<ReaderPaneHandle>;
  onJump: (index: number) => void;
  onFollowLive?: (on: boolean) => void;
  onSave: (format: ExportFormat) => void;
  onEncoding: (encoding: ManualEncoding) => void;
  onRename: () => void;
  onShare: () => void;
  onDelete: () => void;
  onSaveText: (text: string) => void;
}) {
  const activeRef = useRef<HTMLDivElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [localReveal, setLocalReveal] = useState(0);
  const ignoreScroll = useRef(false);
  const canEdit = doc.charCount <= EDIT_LIMIT;
  const seenReveal = useRef(0);
  const seenPin = useRef(0);
  const pinnedIndex = useRef<number | null>(null);

  const markUserScroll = () => {
    if (ignoreScroll.current) return;
    onFollowLive?.(false);
  };

  useEffect(() => {
    setEditing(false);
    setDraft(canEdit ? doc.rawText : "");
    setFindIndex(0);
    setFindQuery("");
    setFindOpen(false);
  }, [doc.id, doc.rawText, canEdit]);

  const matches = useMemo(
    () => (findOpen ? findInSentences(sentences, findQuery) : []),
    [sentences, findQuery, findOpen],
  );
  const safeIndex = matches.length ? Math.min(findIndex, matches.length - 1) : 0;
  const currentMatch = matches[safeIndex] ?? null;

  useEffect(() => {
    setFindIndex(0);
  }, [findQuery, doc.id]);

  const scrollToActive = (force = false) => {
    const mark = document.querySelector("[data-search-hit='current']") || document.querySelector(`[data-sent="${activeIndex}"]`);
    const el = (mark as HTMLElement | null) ?? activeRef.current;
    if (!el) return;
    const root = el.closest("[data-reader-scroll]") as HTMLElement | null;
    if (!root) return;
    ignoreScroll.current = true;
    const moved = force ? revealInContainer(root, el) : followInContainer(root, el);
    if (!moved) {
      ignoreScroll.current = false;
      return;
    }
    window.setTimeout(() => {
      ignoreScroll.current = false;
    }, force ? 80 : 700);
  };

  const pinActiveToTop = () => {
    const el = (document.querySelector(`[data-sent="${activeIndex}"]`) as HTMLElement | null) ?? activeRef.current;
    if (!el) return;
    const root = el.closest("[data-reader-scroll]") as HTMLElement | null;
    if (!root) return;
    ignoreScroll.current = true;
    const row = el.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    root.scrollBy({ top: row.top - box.top, behavior: "auto" });
    window.setTimeout(() => {
      ignoreScroll.current = false;
    }, 120);
  };

  useImperativeHandle(ref, () => ({
    openFind: () => {
      setFindOpen(true);
      setEditing(false);
      queueMicrotask(() => findInputRef.current?.focus());
    },
    revealCurrent: () => {
      setLocalReveal((n) => n + 1);
    },
  }));

  const units: ReadingUnit[] = useMemo(() => unitsFromSentences(sentences), [sentences]);
  const useVirtual = units.length > VIRTUALIZE_AFTER;

  const reveal = revealNonce + localReveal;

  useEffect(() => {
    if (!scrollToActiveNonce || useVirtual) return;
    requestAnimationFrame(() => {
      window.setTimeout(() => {
        const el = activeRef.current;
        const root = el?.closest("[data-reader-scroll]");
        if (el && root instanceof HTMLElement) {
          const delta = el.getBoundingClientRect().top - root.getBoundingClientRect().top;
          root.scrollBy({ top: delta, behavior: "auto" });
        }
        window.scrollTo(0, 0);
      }, 50);
    });
  }, [scrollToActiveNonce, useVirtual]);

  useEffect(() => {
    if (editing) return;
    if (findOpen && findQuery.trim()) {
      const mark = document.querySelector("[data-search-hit='current']");
      if (mark) {
        const root = mark.closest("[data-reader-scroll]") as HTMLElement | null;
        if (root && mark instanceof HTMLElement) {
          ignoreScroll.current = true;
          const row = mark.getBoundingClientRect();
          const box = root.getBoundingClientRect();
          root.scrollBy({ top: row.top - box.top - box.height / 3, behavior: "auto" });
          window.setTimeout(() => {
            ignoreScroll.current = false;
          }, 80);
        }
        return;
      }
    }
    const jump = reveal !== seenReveal.current;
    if (jump) seenReveal.current = reveal;
    if (jump && !useVirtual) {
      requestAnimationFrame(() => {
        const el = activeRef.current;
        const root = el?.closest("[data-reader-scroll]");
        if (el && root instanceof HTMLElement) {
          const delta = el.getBoundingClientRect().top - root.getBoundingClientRect().top;
          root.scrollBy({ top: delta, behavior: "auto" });
        }
      });
    }
    if (pinTopSignal !== seenPin.current) {
      seenPin.current = pinTopSignal;
      if (pinTopSignal > 0) {
        pinnedIndex.current = activeIndex;
        if (!useVirtual) {
          window.setTimeout(() => pinActiveToTop(), 70);
        }
        return;
      }
    }
    if (pinnedIndex.current === activeIndex) return;
    if (pinnedIndex.current !== null) pinnedIndex.current = null;
    if (useVirtual) return;
    if (!followPlayback) return;
    scrollToActive(false);
  }, [activeIndex, doc.id, editing, findOpen, findQuery, currentMatch?.sentenceIndex, currentMatch?.start, sentences.length, followPlayback, reveal, useVirtual, pinTopSignal]);

  const onJumpRef = useRef(onJump);
  onJumpRef.current = onJump;

  useEffect(() => {
    if (!findOpen || !currentMatch) return;
    onJumpRef.current(currentMatch.sentenceIndex);
  }, [findOpen, currentMatch]);

  const pct = readingProgress(activeIndex, sentences.length || doc.sentenceCount);
  const encodingValue = (
    MANUAL_ENCODINGS.some((e) => e.id === doc.encoding) ? doc.encoding : "auto"
  ) as ManualEncoding;
  const canRedecode = Boolean(doc.sourceBytes && doc.sourceBytes.byteLength);

  const goMatch = (delta: number) => {
    if (!matches.length) return;
    setFindIndex((i) => (i + delta + matches.length) % matches.length);
  };

  return (
    <article
      className="mx-auto flex h-full min-h-0 w-full max-w-2xl flex-col overflow-hidden px-5 pt-2 md:pt-3 xl:max-w-[72rem]"
      onWheel={markUserScroll}
      onTouchStart={markUserScroll}
      onTouchMove={markUserScroll}
    >
      <div data-chrome="book-tools" className="sticky top-0 z-20 -mx-5 mb-3 shrink-0 border-b border-line bg-paper/95 px-5 py-1.5 backdrop-blur-sm">
        <div className="lr-book-tools flex w-full min-w-0 items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setFindOpen(true);
              setEditing(false);
              queueMicrotask(() => findInputRef.current?.focus());
            }}
          >
            <Search className="size-3.5" />
            Find
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setLocalReveal((n) => n + 1);
              queueMicrotask(() => scrollToActive(true));
            }}
          >
            <Locate className="size-3.5" />
            Here
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm">
                <MoreHorizontal className="size-3.5" />
                More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem disabled={!canEdit} onSelect={() => canEdit && setEditing((v) => !v)}>
                <Pencil className="size-3.5" />
                {editing ? "Close editor" : "Edit page"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem>
              <DropdownMenuItem onSelect={onShare}>
                <Share2 className="size-3.5" />
                Share
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {canRedecode
                ? MANUAL_ENCODINGS.map((enc) => (
                    <DropdownMenuItem key={enc.id} onSelect={() => onEncoding(enc.id)}>
                      {enc.label}
                      {encodingValue === enc.id ? " · on" : ""}
                    </DropdownMenuItem>
                  ))
                : (
                    <DropdownMenuItem disabled>{doc.encoding.toUpperCase()}</DropdownMenuItem>
                  )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onDelete()} className="text-danger">
                <Trash2 className="size-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <SaveMenu onExport={onSave} onShare={onShare} disabled={editing} />
          <Badge className="ml-auto tabular-nums">{pct}%</Badge>
        </div>
        {hydrated && findOpen ? (
          <div className="mt-2">
            <FindBar
              query={findQuery}
              count={matches.length}
              current={safeIndex}
              inputRef={findInputRef}
              onQuery={setFindQuery}
              onPrev={() => goMatch(-1)}
              onNext={() => goMatch(1)}
              onClose={() => {
                setFindOpen(false);
                setFindQuery("");
              }}
            />
          </div>
        ) : null}
      </div>

      <header data-chrome="book-hero" className="mb-5 shrink-0">
        <button
          type="button"
          onClick={onRename}
          className="group mt-1 flex min-w-0 max-w-full items-start gap-2 text-left"
          aria-label={`Rename ${doc.title}`}
        >
          <h1 className="min-w-0 max-w-full break-words font-display text-2xl leading-tight font-medium tracking-[-0.03em] text-ink md:text-3xl">
            {doc.title}
          </h1>
          <Pencil className="mt-1.5 size-4 shrink-0 text-faint transition-colors group-hover:text-ink" />
        </button>
        <p className="mt-1 font-sans text-[11px] text-muted tabular-nums">
          {formatCount(doc.charCount)} characters
          {!canEdit ? " · long book, editor off" : ""}
        </p>
      </header>

      {doc.frontPages?.length ? (
        <details className="mb-4 rounded-lg border border-line bg-paper px-3 py-2">
          <summary className="cursor-pointer font-sans text-sm text-ink">Pictures and preface</summary>
          <div className="mt-3 space-y-6">
            {doc.frontPages.map((page) => (
              <section key={page.title}>
                <h2 className="mb-2 font-display text-lg text-ink">{page.title}</h2>
                <div className="lr-epub-html text-ink-soft" dangerouslySetInnerHTML={{ __html: page.html }} />
              </section>
            ))}
          </div>
        </details>
      ) : null}

      {editing && canEdit ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSaveText(draft);
            setEditing(false);
          }}
        >
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Document text"
            style={{ fontSize: `${fontSize}px`, lineHeight: 1.7 }}
            className="min-h-[28rem]"
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(doc.rawText);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Save page
            </Button>
          </div>
        </form>
      ) : (
        <div
          data-reader-text
          data-reader-scroll={useVirtual ? undefined : "book"}
          className={cn(
            "min-h-0 min-w-0 flex-1 overflow-x-clip break-all font-serif text-ink-soft text-pretty",
            useVirtual ? "overflow-hidden" : "overflow-y-auto overscroll-y-none",
          )}
          style={{
            fontSize: `${fontSize}px`,
            lineHeight: 1.7,
            overflowAnchor: "none",
          }}
        >
          {preparing && units.length === 0 ? (
            <p className="text-muted">Laying out this book…</p>
          ) : units.length === 0 ? (
            <p className="text-muted">This document is empty. Try UTF-8, GBK, or GB18030, or drop a different file.</p>
          ) : useVirtual ? (
            <VirtualPassage
              key={doc.id}
              units={units}
              activeIndex={activeIndex}
              fontSize={fontSize}
              findQuery={findOpen ? findQuery : ""}
              activeStart={
                currentMatch && currentMatch.sentenceIndex === activeIndex ? currentMatch.start : null
              }
              followPlayback={followPlayback}
              scrollToActiveNonce={scrollToActiveNonce}
              onUserScroll={() => onFollowLive?.(false)}
              onJump={(index) => {
                onFollowLive?.(true);
                onJump(index);
              }}
            />
          ) : (
            units.map((unit, index) => {
              const active = index === activeIndex;
              const activeStart =
                currentMatch && currentMatch.sentenceIndex === index ? currentMatch.start : null;
              return (
                <span key={`${doc.id}-${index}`}>
                  {unit.para && index > 0 ? <span className="block h-[0.95em]" /> : index > 0 ? " " : null}
                  <div
                    role="button"
                    tabIndex={-1}
                    data-sent={index}
                    ref={active ? activeRef : undefined}
                    onClick={() => {
                      onFollowLive?.(true);
                      onJump(index);
                    }}
                    className={cn(
                      "scroll-mb-[var(--player-clearance)] cursor-pointer rounded-sm text-left transition-[background-color,box-shadow,color] duration-[var(--motion-quick)] ease-[var(--ease-out)]",
                      active
                        ? "bg-mark text-ink shadow-[inset_3px_0_0_0_var(--color-pine)]"
                        : "hover:bg-paper-sunken/80",
                    )}
                  >
                    <HighlightedText text={unit.text} query={findOpen ? findQuery : ""} activeStart={activeStart} />
                  </div>
                </span>
              );
            })
          )}
        </div>
      )}
    </article>
  );
}
