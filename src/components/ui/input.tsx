import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-md bg-paper-sunken px-3 font-sans text-sm text-ink shadow-[var(--shadow-border)]",
        "placeholder:text-faint focus-visible:ring-2 focus-visible:ring-pine/50 focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}
