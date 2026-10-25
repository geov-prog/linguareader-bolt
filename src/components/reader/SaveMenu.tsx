import { FileDown, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EXPORT_OPTIONS, type ExportFormat } from "@/services/FileExport";

export function SaveMenu({
  disabled,
  onExport,
  onShare,
}: {
  disabled?: boolean;
  onExport: (format: ExportFormat) => void;
  onShare?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled} aria-label="Save this book">
          <FileDown className="size-3.5" />
          <span className="lr-save-label">Save book</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>This book only</DropdownMenuLabel>
        {onShare ? (
          <DropdownMenuItem onSelect={() => onShare()}>
            <span className="flex items-center gap-2">
              <Share2 className="size-3.5" />
              Share a copy
            </span>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Save as a file</DropdownMenuLabel>
        {EXPORT_OPTIONS.map((option) => (
          <DropdownMenuItem key={option.id} onSelect={() => onExport(option.id)}>
            <span>{option.label}</span>
            <span className="font-sans text-xs text-muted tabular-nums">{option.hint}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
