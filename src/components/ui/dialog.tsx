import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn("fixed inset-0 z-50 bg-ink/35", className)}
      {...props}
    />
  );
}

export function DialogContent({
  className,
  children,
  layout = "dialog",
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { layout?: "dialog" | "sheet" }) {
  const sheet = layout === "sheet";
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 z-50 flex w-[min(24rem,calc(100vw-1.25rem))] -translate-x-1/2 flex-col bg-paper-raised text-ink shadow-[var(--shadow-border-hover)]",
          sheet
            ? "top-[max(0.4rem,env(safe-area-inset-top))] bottom-[max(0.4rem,env(safe-area-inset-bottom))] overflow-hidden rounded-xl p-0"
            : "top-1/2 max-h-[calc(100svh-2rem)] -translate-y-1/2 overflow-y-auto overscroll-contain rounded-xl p-5 [-webkit-overflow-scrolling:touch]",
          className,
        )}
        {...props}
      >
        {sheet ? (
          children
        ) : (
          <>
            <div className="sticky top-0 z-20 -mx-2 mb-1 flex justify-end bg-paper-raised">
              <DialogPrimitive.Close
                type="button"
                aria-label="Close"
                className="inline-flex size-11 items-center justify-center rounded-lg text-ink hover:bg-paper-sunken"
              >
                <X className="size-5" />
              </DialogPrimitive.Close>
            </div>
            {children}
          </>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("font-display text-xl text-ink", className)}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("mt-1 font-sans text-sm text-muted", className)}
      {...props}
    />
  );
}
