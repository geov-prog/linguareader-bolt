import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function RenameDialog({
  open,
  title,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
  onSave: (title: string) => void;
}) {
  const [value, setValue] = useState(title);

  useEffect(() => {
    if (open) setValue(title);
  }, [open, title]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Rename this book</DialogTitle>
        <DialogDescription>This name is what you will see in the library and on the lock screen.</DialogDescription>
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(value);
          }}
        >
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            maxLength={120}
            aria-label="Document name"
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
