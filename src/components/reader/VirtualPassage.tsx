import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { HighlightedText } from "@/components/reader/FindBar";
import { cn } from "@/lib/utils";
import { clearBackgroundSync, isScrollLocked, isSilentSync, peekBackgroundSync, setRenderedRange } from "@/services/SpeechManager";
import { isAndroid } from "@/utils/platform";
import type { ReadingUnit } from "@/utils/sentences";

const WINDOW = 120;
const PAGE = 40;
const MAX_SPAN = 160;

function placeAtTop(root: HTMLElement, el: HTMLElement, behavior: ScrollBehavior): boolean {
  const delta = el.getBoundingClientRect().top - root.getBoundingClientRect().top;
  if (Math.abs(delta) < 4) return false;
  root.scrollBy({ top: delta, behavior });
  return true;
}

function easeToGolden(root: HTMLElement, el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  const below = rect.top >= window.innerHeight * 0.5;
  const above = rect.bottom < root.getBoundingClientRect().top + 8;
  if (!below && !above) return false;
  const delta = rect.top - window.innerHeight * 0.3;
  if (Math.abs(delta) < 8) return false;
  root.scrollBy({ top: delta, behavior: "smooth" });
  return true;
}

export function followInContainer(root: HTMLElement, el: HTMLElement): boolean {
  return easeToGolden(root, el);
}

export function revealInContainer(root: HTMLElement, el: HTMLElement): boolean {
  return placeAtTop(root, el, "smooth");
}

function parkReadingLine(root: HTMLElement, el: HTMLElement, force: boolean) {
  if (!force) return followInContainer(root, el);
  return revealInContainer(root, el);
}

export function VirtualPassage({
  units,
  activeIndex,
  findQuery,
  activeStart,
  followPlayback = false,
  scrollToActiveNonce = 0,
  isBackgroundSync = false,
  onJump,
  onUserScroll,
}: {
  units: ReadingUnit[];
  activeIndex: number;
  fontSize: number;
  findQuery: string;
  activeStart: number | null;
  followPlayback?: boolean;
  scrollToActiveNonce?: number;
  isBackgroundSync?: boolean;
  onJump: (index: number) => void;
  onUserScroll?: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(followPlayback);
  followRef.current = followPlayback;
  const prependLock = useRef(false);
  const ignoreUser = useRef(false);
  const anchorRef = useRef<{ index: number; top: number } | null>(null);
  const activeSentenceRef = useRef<HTMLDivElement | null>(null);
  const seenScroll = useRef(scrollToActiveNonce);
  const scrollLockRef = useRef(false);
  const scrollUnlockRef = useRef<number | null>(null);
  const hereHold = useRef(0);
  const pendingCatch = useRef(false);
  const n = units.length;
  const [range, setRange] = useState(() => {
    const start = Math.max(0, activeIndex - 24);
    return { start, end: Math.min(n, start + WINDOW) };
  });

  const slice = units.slice(range.start, range.end);
  const skipBackgroundScroll = isBackgroundSync || peekBackgroundSync();

  const armScrollLock = () => {
    if (!isAndroid() || !isScrollLocked()) return false;
    scrollLockRef.current = true;
    if (scrollUnlockRef.current != null) window.clearTimeout(scrollUnlockRef.current);
    scrollUnlockRef.current = window.setTimeout(() => {
      scrollLockRef.current = false;
      scrollUnlockRef.current = null;
    }, 500);
    return true;
  };

  useEffect(() => {
    return () => {
      if (scrollUnlockRef.current != null) window.clearTimeout(scrollUnlockRef.current);
    };
  }, []);

  useEffect(() => {
    setRenderedRange(range.start, range.end);
  }, [range.start, range.end]);

  useEffect(() => {
    return () => setRenderedRange(0, Number.POSITIVE_INFINITY);
  }, []);

  useEffect(() => {
    if (!scrollToActiveNonce || scrollToActiveNonce === seenScroll.current) return;
    seenScroll.current = scrollToActiveNonce;
    hereHold.current = Date.now() + 1000;
    pendingCatch.current = false;
    const start = Math.max(0, Math.min(activeIndex, Math.max(0, n - 1)));
    const end = Math.min(n, start + 40);
    if (start !== range.start || end !== range.end) setRange({ start, end });
    const nonce = scrollToActiveNonce;
    requestAnimationFrame(() => {
      window.setTimeout(() => {
        if (seenScroll.current !== nonce) return;
        const root = scrollerRef.current;
        if (!root) return;
        const el = activeSentenceRef.current;
        if (el && root.contains(el)) placeAtTop(root, el, "auto");
        else root.scrollTo({ top: 0, behavior: "auto" });
        window.scrollTo(0, 0);
      }, 50);
    });
  }, [scrollToActiveNonce, activeIndex, n, range.start, range.end]);

  useLayoutEffect(() => {
    if (armScrollLock() || scrollLockRef.current) return;
    if (isSilentSync() || skipBackgroundScroll) return;
    if (activeIndex < range.start || activeIndex >= range.end) {
      const start = Math.max(0, Math.min(activeIndex, Math.max(0, n - 1)));
      const end = Math.min(n, start + 40);
      if (start !== range.start || end !== range.end) setRange({ start, end });
      if (!followPlayback || Date.now() < hereHold.current) return;
      pendingCatch.current = true;
      const index = activeIndex;
      window.setTimeout(() => {
        requestAnimationFrame(() => {
          pendingCatch.current = false;
          if (!followRef.current || Date.now() < hereHold.current) return;
          if (scrollLockRef.current) return;
          const root = scrollerRef.current;
          const el = activeSentenceRef.current;
          if (!root || !el || Number(el.dataset.sent) !== index) return;
          easeToGolden(root, el);
        });
      }, 100);
      return;
    }
    if (activeIndex < range.end - 12 && activeIndex >= range.start) return;
    if (!followPlayback) {
      if (activeIndex >= range.end - 4 && range.end < n) {
        setRange({ start: range.start, end: Math.min(n, activeIndex + 40) });
      }
      return;
    }
    const root = scrollerRef.current;
    let nextEnd = Math.min(n, Math.max(range.end + PAGE, activeIndex + 40));
    let nextStart = range.start;
    if (nextEnd - nextStart > MAX_SPAN) nextStart = nextEnd - MAX_SPAN;
    if (nextStart > activeIndex) nextStart = activeIndex;
    if (nextEnd <= activeIndex) nextEnd = Math.min(n, activeIndex + 1);
    if (nextStart === range.start && nextEnd === range.end) return;
    if (root && nextStart > range.start) {
      const keep = root.querySelector(`[data-sent="${nextStart}"]`);
      if (keep instanceof HTMLElement) {
        anchorRef.current = { index: nextStart, top: keep.getBoundingClientRect().top };
      }
    }
    setRange({ start: nextStart, end: nextEnd });
  }, [activeIndex, n, range.start, range.end, followPlayback, skipBackgroundScroll]);

  useLayoutEffect(() => {
    if (armScrollLock() || scrollLockRef.current) return;
    if (skipBackgroundScroll) {
      clearBackgroundSync();
      return;
    }
    const root = scrollerRef.current;
    const anchor = anchorRef.current;
    if (root && anchor) {
      const pinned = root.querySelector(`[data-sent="${anchor.index}"]`);
      if (pinned instanceof HTMLElement) {
        root.scrollBy({ top: pinned.getBoundingClientRect().top - anchor.top, behavior: "auto" });
      }
      anchorRef.current = null;
      prependLock.current = false;
    }
    if (activeIndex < range.start || activeIndex >= range.end) return;
    if (pendingCatch.current || Date.now() < hereHold.current) return;
    if (isSilentSync()) return;
    if (!followPlayback) return;
    if (!root) return;
    const el = activeSentenceRef.current ?? root.querySelector(`[data-sent="${activeIndex}"]`);
    if (!(el instanceof HTMLElement)) return;
    const moved = parkReadingLine(root, el, false);
    if (!moved) return;
    ignoreUser.current = true;
    window.setTimeout(() => {
      ignoreUser.current = false;
    }, 700);
  }, [activeIndex, range.start, range.end, followPlayback, skipBackgroundScroll]);

  const shiftEarlier = () => {
    const root = scrollerRef.current;
    if (!root || range.start <= 0 || prependLock.current) return;
    prependLock.current = true;
    const boxTop = root.getBoundingClientRect().top;
    let anchorIndex = range.start;
    let anchorTop = boxTop;
    for (let i = range.start; i < range.end; i += 1) {
      const el = root.querySelector(`[data-sent="${i}"]`);
      if (!(el instanceof HTMLElement)) continue;
      const top = el.getBoundingClientRect().top;
      if (top >= boxTop - 4) {
        anchorIndex = i;
        anchorTop = top;
        break;
      }
    }
    anchorRef.current = { index: anchorIndex, top: anchorTop };
    const nextStart = Math.max(0, range.start - PAGE);
    let nextEnd = range.end - range.start > MAX_SPAN ? Math.min(n, range.end - PAGE) : range.end;
    if (nextEnd <= activeIndex) nextEnd = Math.min(n, activeIndex + 1);
    setRange({ start: nextStart, end: nextEnd });
  };

  const shiftLater = () => {
    if (range.end >= n) return;
    const nextEnd = Math.min(n, range.end + PAGE);
    let nextStart = nextEnd - range.start > MAX_SPAN ? nextEnd - MAX_SPAN : range.start;
    if (nextStart > activeIndex) nextStart = activeIndex;
    setRange({ start: nextStart, end: Math.max(nextEnd, activeIndex + 1) });
  };

  const noteUserScroll = () => {
    if (ignoreUser.current) return;
    followRef.current = false;
    onUserScroll?.();
  };

  const onScroll = () => {
    const root = scrollerRef.current;
    if (!root) return;
    if (!ignoreUser.current && followRef.current) {
      const activeEl = root.querySelector(`[data-sent="${activeIndex}"]`);
      if (activeEl) {
        const box = root.getBoundingClientRect();
        const r = activeEl.getBoundingClientRect();
        if (r.bottom < box.top + 8 || r.top > box.bottom - 8) noteUserScroll();
      }
    }
    if (root.scrollTop < 48 && range.start > 0) shiftEarlier();
    if (root.scrollHeight - root.scrollTop - root.clientHeight < 72 && range.end < n) shiftLater();
  };

  if (!n) return null;

  return (
    <div
      ref={scrollerRef}
      data-reader-scroll="book"
      onScroll={onScroll}
      onWheel={noteUserScroll}
      onTouchStart={noteUserScroll}
      onTouchMove={noteUserScroll}
      className="h-full min-h-[12rem] overflow-y-auto overscroll-y-none pr-1"
      style={{
        WebkitOverflowScrolling: "touch",
        touchAction: "pan-y",
        overflowAnchor: "none",
      }}
    >
      {range.start > 0 ? (
        <button
          type="button"
          className="mb-3 w-full rounded-lg bg-paper-sunken py-2 font-sans text-xs text-ink"
          onClick={() => {
            followRef.current = false;
            onUserScroll?.();
            shiftEarlier();
          }}
        >
          Earlier in the book · {range.start.toLocaleString()} before
        </button>
      ) : null}
      {slice.map((unit, offset) => {
        const index = range.start + offset;
        const active = index === activeIndex;
        const matchStart = active && activeStart != null ? activeStart : null;
        return (
          <div
            key={index}
            data-sent={index}
            ref={active ? activeSentenceRef : undefined}
            style={{ overflowAnchor: "none" }}
          >
            {unit.para && offset > 0 ? <div className="h-[0.95em]" /> : null}
            <div
              role="button"
              tabIndex={-1}
              onClick={() => onJump(index)}
              className={cn(
                "w-full min-w-0 cursor-pointer overflow-x-clip break-all rounded-sm px-0.5 py-0.5 text-left transition-[background-color,box-shadow,color] duration-[var(--motion-quick)] ease-[var(--ease-out)]",
                active
                  ? "bg-mark text-ink shadow-[inset_3px_0_0_0_var(--color-pine)]"
                  : "hover:bg-paper-sunken/80",
              )}
            >
              <HighlightedText text={unit.text} query={findQuery} activeStart={matchStart} />
            </div>
          </div>
        );
      })}
      {range.end < n ? (
        <button
          type="button"
          className="mt-3 mb-6 w-full rounded-lg bg-paper-sunken py-2 font-sans text-xs text-ink"
          onClick={() => {
            followRef.current = false;
            onUserScroll?.();
            shiftLater();
          }}
        >
          Later in the book · {(n - range.end).toLocaleString()} after
        </button>
      ) : (
        <div className="h-8" />
      )}
    </div>
  );
}
