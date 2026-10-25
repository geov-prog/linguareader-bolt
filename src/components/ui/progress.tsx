import { cn } from "@/lib/utils";

export function Progress({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      className={cn("h-1 overflow-hidden rounded-full bg-paper-sunken", className)}
      aria-hidden={true}
    >
      <div
        className="h-full rounded-full bg-pine transition-[width] duration-[var(--motion-fast)] ease-[var(--ease-smooth-out)]"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
