import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

export function ResumeDialog({
  open,
  title,
  percent,
  onContinue,
  onRestart,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  percent: number;
  onContinue: () => void;
  onRestart: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Continue where you left off?</DialogTitle>
        <DialogDescription>
          You were {percent}% through “{title}”. Place is saved on this phone, even if the app was swiped away.
        </DialogDescription>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={onRestart}>
            Start of book
          </Button>
          <Button type="button" size="sm" onClick={onContinue}>
            Continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
