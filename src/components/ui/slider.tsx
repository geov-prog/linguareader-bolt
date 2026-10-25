import * as SliderPrimitive from "@radix-ui/react-slider";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Slider({
  className,
  ...props
}: ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      className={cn(
        "relative flex h-11 w-full touch-none items-center select-none",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-paper-sunken">
        <SliderPrimitive.Range className="absolute h-full bg-pine" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block size-4 rounded-full bg-paper-raised shadow-[var(--shadow-border-hover)] transition-[box-shadow,transform] duration-[var(--motion-quick)] ease-[var(--ease-out)] hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine/50" />
    </SliderPrimitive.Root>
  );
}
