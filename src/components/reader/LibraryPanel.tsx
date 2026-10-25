import { ArrowUpDown, ChevronDown, Download, FileText, MoreHorizontal, Pencil, Search, Share2, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn, formatRelativeTime } from "@/lib/utils";
import { sortLibraryDocuments, type DocumentRecord, type LibrarySortMode } from "@/services/StorageService";
import { documentMatchesQuery } from "@/utils/search";
import { readingProgress } from "@/utils/sentences";
import { FILE_INPUT_ID } from "@/services/FileImport";
import { APP_VERSION_LABEL } from "@/lib/app-info";
import { scanChapters, type ChapterMark } from "@/utils/chapters";
import { sentenceIndexAt, splitSentences } from "@/utils/sentences";

const SORT_KEY = "linguareader.sortMode";
const SORT_ORDER: LibrarySortMode[] = ["recent", "title", "progress", "lastRead"];
const SORT_LABEL: Record<LibrarySortMode, string> = {
  recent: "Recent",
  title: "A-Z",
  progress: "Read %",
  lastRead: "Last Read",
};

function readSortMode(): LibrarySortMode {
  try {
    const saved = localStorage.getItem(SORT_KEY);
    if (saved === "recent" || saved === "title" || saved === "progress" || saved === "lastRead") return saved;
  } catch {
    /* private mode */
  }
  return "recent";
}

function activeChapterAt(chapters: ChapterMark[], sentenceIndex: number): number {
  let active = -1;
  for (let i = 0; i < chapters.length; i++) {
    if ((chapters[i]?.sentenceIndex ?? 0) <= sentenceIndex) active = i;
    else break;
  }
  return active;
}

function ChapterDrawer({
  doc,
  progressIndex,
  onJump,
  open,
}: {
  doc: DocumentRecord;
  progressIndex: number;
  onJump?: (id: string, sentenceIndex: number) => void;
  open: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const chapters = useMemo(() => {
    if (!open) return doc.chapters ?? [];
    if (Array.isArray(doc.chapters)) return doc.chapters;
    return scanChapters(doc.rawText, splitSentences(doc.rawText));
  }, [open, doc]);
  const here = open ? activeChapterAt(chapters, progressIndex) : -1;

  useEffect(() => {
    if (!open) return;
    const item = listRef.current?.querySelector<HTMLElement>("[data-current-chapter]");
    const inner = listRef.current;
    if (!(item instanceof HTMLElement) || !(inner instanceof HTMLElement)) return;
    if (inner.scrollHeight <= inner.clientHeight + 4) return;
    const box = inner.getBoundingClientRect();
    const row = item.getBoundingClientRect();
    if (row.top < box.top + 8) inner.scrollTop += row.top - box.top - 8;
    else if (row.bottom > box.bottom - 8) inner.scrollTop += row.bottom - box.bottom + 8;
  }, [open]);

  if (!open && !doc.chapters?.length && !doc.rawText) return null;

  return (
    <>
      {open ? (
        <div ref={listRef} className="lr-chapter-scroll">
          {chapters.length === 0 ? (
            <p className="px-2 py-2 font-sans text-[11px] text-muted">No chapter headings in this book.</p>
          ) : (
            <ul className="m-0 list-none p-0 pb-3">
              {chapters.map((chapter: ChapterMark, index) => {
                const current = index === here;
                return (
                  <li key={`${chapter.charOffset}-${chapter.title}`}>
                    <button
                      type="button"
                      data-current-chapter={current ? "" : undefined}
                      aria-current={current ? "true" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2 px-2 py-1.5 text-left font-sans text-xs hover:bg-paper-raised",
                        current ? "bg-mark font-semibold text-ink" : "text-ink",
                      )}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={(event) => {
                        event.preventDefault();
                        const scroller = event.currentTarget.closest("[data-library-scroll]");
                        const kept = scroller instanceof HTMLElement ? scroller.scrollTop : 0;
                        onJump?.(
                          doc.id,
                          typeof chapter.startSentenceIndex === "number"
                            ? chapter.startSentenceIndex
                            : sentenceIndexAt(doc.rawText, chapter.charOffset),
                        );
                        window.scrollTo(0, 0);
                        if (scroller instanceof HTMLElement) scroller.scrollTop = kept;
                        requestAnimationFrame(() => {
                          window.scrollTo(0, 0);
                          if (scroller instanceof HTMLElement) scroller.scrollTop = kept;
                        });
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{chapter.title}</span>
                      {current ? (
                        <span className="shrink-0 rounded-full bg-ink/10 px-1.5 py-0.5 font-sans text-[10px] font-semibold tracking-wide text-ink uppercase">
                          Here
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </>
  );
}

export function LibraryPanel({
  documents,
  activeId,
  hydrated = true,
  lastBackupAt,
  onSelect,
  onDelete,
  onRename,
  onShare,
  onSaveBook,
  onImportClick,
  onOpenBackup,
  onJumpChapter,
  readingIndex,
  readingLive = false,
  onClose,
}: {
  documents: DocumentRecord[];
  activeId: string | null;
  hydrated?: boolean;
  lastBackupAt?: number | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string) => void;
  onShare: (id: string) => void;
  onSaveBook?: (id: string) => void;
  onImportClick: () => void;
  onOpenBackup?: () => void;
  onJumpChapter?: (id: string, sentenceIndex: number) => void;
  readingIndex?: number | null;
  /** True only while this book is actually being read aloud. */
  readingLive?: boolean;
  onClose?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [openBookId, setOpenBookId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<LibrarySortMode>(readSortMode);
  const visible = useMemo(
    () => sortLibraryDocuments(documents.filter((doc) => documentMatchesQuery(doc, query)), sortMode),
    [documents, query, sortMode],
  );

  useEffect(() => {
    try {
      localStorage.setItem(SORT_KEY, sortMode);
    } catch {
      /* private mode */
    }
  }, [sortMode]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 px-3 pt-3 pb-1">
        <div className="min-w-0">
          <h2 className="font-display text-lg text-ink">Library</h2>
          <p className="font-sans text-[10px] text-muted">
            {documents.length} · {APP_VERSION_LABEL}
          </p>
        </div>
        {onClose ? (
          <Button variant="ghost" size="sm" onClick={onClose} className="rounded-full md:hidden">
            Close
          </Button>
        ) : null}
      </div>

      <div className="flex gap-2 px-3 pb-1.5">
        <Button asChild variant="outline" size="sm" className="flex-1 rounded-full">
          <label
            htmlFor={FILE_INPUT_ID}
            className="cursor-pointer"
            onClick={(event) => {
              if (!document.getElementById(FILE_INPUT_ID)) {
                event.preventDefault();
                onImportClick();
              }
            }}
          >
            <Upload className="size-3.5" />
            Add
          </label>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1 rounded-full"
          aria-expanded={toolsOpen}
          onClick={() => setToolsOpen((v) => !v)}
        >
          Backup
          <ChevronDown className={cn("size-3.5 transition-transform", toolsOpen ? "rotate-180" : "")} />
        </Button>
      </div>

      {toolsOpen ? (
        <div className="mx-4 mb-2 space-y-2 rounded-xl bg-paper-sunken p-3">
          {onOpenBackup ? (
            <Button type="button" variant="outline" size="sm" className="w-full" onClick={onOpenBackup}>
              <Download className="size-3.5" />
              Save & restore
            </Button>
          ) : null}
          <p className="font-sans text-[11px] leading-snug text-muted">
            Three files: settings, books with chapters, and saved storyteller clips. They stay on this phone.
            {lastBackupAt ? ` Last copy ${formatRelativeTime(lastBackupAt)}.` : ""}
          </p>
        </div>
      ) : null}

      <div className="flex items-center gap-1.5 px-3 pb-1.5">
        {hydrated ? (
          <label className="relative block min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search the library"
              className="h-8 pl-9"
            />
          </label>
        ) : (
          <div className="h-8 min-w-0 flex-1" aria-hidden="true" />
        )}
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-paper-raised px-2.5 font-sans text-[10px] font-medium text-ink shadow-[var(--shadow-border)]"
          aria-label={`Sort by ${SORT_LABEL[sortMode]}. Tap to change.`}
          title={SORT_LABEL[sortMode]}
          onClick={() => {
            const index = SORT_ORDER.indexOf(sortMode);
            const next = SORT_ORDER[(index + 1) % SORT_ORDER.length] ?? "recent";
            setSortMode(next);
          }}
        >
          <ArrowUpDown className="size-3.5" />
          <span>{SORT_LABEL[sortMode]}</span>
        </button>
      </div>

      <div data-library-scroll="" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-1 pb-8 [-webkit-overflow-scrolling:touch] md:pb-[var(--player-clearance)]">
        {documents.length === 0 ? (
          <p className="px-2 py-6 text-center font-sans text-sm text-muted">
            The shelves are empty. Drop a Word, PDF, or text file to begin.
          </p>
        ) : visible.length === 0 ? (
          <p className="px-2 py-6 text-center font-sans text-sm text-muted">
            No documents match “{query.trim()}”.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {visible.map((doc) => {
              const active = doc.id === activeId;
              const pct = readingProgress(doc.sentenceOffset, doc.sentenceCount);
              return (
                <li key={doc.id}>
                  <div
                    className={cn(
                      "group relative rounded-md px-2 py-1.5 transition-colors duration-[var(--motion-quick)]",
                      active ? "bg-paper-sunken" : "hover:bg-paper-raised",
                    )}
                  >
                    <div className={cn("relative", openBookId === doc.id && "lr-book-sticky", active && "is-active")}>
                    <button type="button" onClick={() => onSelect(doc.id)} className="w-full pr-9 text-left">
                      <div className="flex items-center gap-2">
                        <FileText
                          className={cn("size-3.5 shrink-0", active ? "text-pine" : "text-faint")}
                          strokeWidth={1.75}
                        />
                        <span className="min-w-0 flex-1 truncate font-sans text-sm font-medium text-ink">{doc.title}</span>
                        <span className="shrink-0 font-sans text-[10px] text-muted tabular-nums">{pct}%</span>
                      </div>
                      <Progress value={pct} className="mt-1 h-0.5" />
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Edit ${doc.title}`}
                          className="absolute top-2.5 right-2 flex size-9 items-center justify-center rounded-md text-faint hover:bg-paper-raised hover:text-ink"
                        >
                          <MoreHorizontal className="size-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => onRename(doc.id)}>
                          <span className="flex items-center gap-2">
                            <Pencil className="size-3.5" />
                            Rename
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onShare(doc.id)}>
                          <span className="flex items-center gap-2">
                            <Share2 className="size-3.5" />
                            Share this book
                          </span>
                        </DropdownMenuItem>
                        {onSaveBook ? (
                          <DropdownMenuItem onSelect={() => onSaveBook(doc.id)}>
                            <span className="flex items-center gap-2">
                              <Download className="size-3.5" />
                              Save this book
                            </span>
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onDelete(doc.id)}>
                          <span className="flex items-center gap-2 text-danger">
                            <Trash2 className="size-3.5" />
                            Delete book
                          </span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {(doc.chapters?.length || doc.rawText) ? (
                      <button
                        type="button"
                        className="mt-1 flex min-h-8 w-full items-center justify-between px-1 font-sans text-[11px] text-muted"
                        aria-expanded={openBookId === doc.id}
                        onClick={() => setOpenBookId(openBookId === doc.id ? null : doc.id)}
                      >
                        <span>
                          {openBookId === doc.id
                            ? "Hide chapters"
                            : doc.chapters?.length
                              ? `Chapters · ${doc.chapters.length}`
                              : "Chapters"}
                        </span>
                        <ChevronDown className={cn("size-3.5 transition-transform", openBookId === doc.id ? "rotate-180" : "")} />
                      </button>
                    ) : null}
                    </div>
                    <ChapterDrawer
                      doc={doc}
                      open={openBookId === doc.id}
                      progressIndex={
                        doc.id === activeId && readingLive && typeof readingIndex === "number"
                          ? readingIndex
                          : doc.sentenceOffset
                      }
                      onJump={onJumpChapter}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="px-4 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Badge>Saved on this phone · no account</Badge>
      </div>
    </div>
  );
}
