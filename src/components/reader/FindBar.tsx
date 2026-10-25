import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function FindBar({
  query,
  count,
  current,
  inputRef,
  onQuery,
  onPrev,
  onNext,
  onClose,
}: {
  query: string;
  count: number;
  current: number;
  inputRef?: RefObject<HTMLInputElement | null>;
  onQuery: (value: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const label = !query.trim() ? "" : count === 0 ? "0 matches" : `${current + 1} / ${count}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) onPrev();
              else onNext();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="Search this page"
          aria-label="Search this page"
          className="h-10 pl-9"
        />
      </label>
      <span className="min-w-16 text-right font-sans text-xs text-muted tabular-nums">{label}</span>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={onPrev}
        disabled={count === 0}
        aria-label="Previous match"
      >
        <ChevronUp className="size-4" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={onNext}
        disabled={count === 0}
        aria-label="Next match"
      >
        <ChevronDown className="size-4" />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close search">
        <X className="size-4" />
      </Button>
    </div>
  );
}

export function HighlightedText({
  text,
  query,
  activeStart,
}: {
  text: string;
  query: string;
  activeStart?: number | null;
}): ReactNode {
  const needle = query.trim();
  if (!needle) return text;
  const hay = text.toLocaleLowerCase();
  const fold = needle.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < text.length) {
    const at = hay.indexOf(fold, i);
    if (at < 0) {
      parts.push(text.slice(i));
      break;
    }
    if (at > i) parts.push(text.slice(i, at));
    const current = activeStart === at;
    parts.push(
      <mark
        key={`${at}-${n++}`}
        data-search-hit={current ? "current" : "match"}
        className={cn(
          "rounded-sm px-0.5",
          current ? "bg-pine text-pine-fg" : "bg-mark text-ink",
        )}
      >
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    i = at + fold.length;
  }
  return parts;
}
