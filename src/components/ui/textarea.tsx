import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-64 w-full resize-y rounded-lg bg-paper-sunken px-4 py-3 font-serif text-ink shadow-[var(--shadow-border)]",
        "placeholder:text-faint focus-visible:ring-2 focus-visible:ring-pine/50 focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}
