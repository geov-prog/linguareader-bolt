/** Payload codes. `ful` and `jrn` are the published codes. `set` and `voc` are the other two saves. */
export type BackupKind = "ful" | "jrn" | "set" | "voc";

export type BackupEnv = "apk" | "web" | "ios" | "win";

/** `260925-2344` from the device clock. */
export function formatBackupStamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(date.getFullYear() % 100)}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
}

export function backupFileName(
  type: BackupKind,
  env: BackupEnv,
  id: string,
  date = new Date(),
  ext: "json" | "csv" = "json",
): string {
  const safeId = id.replace(/[^a-z0-9-]/gi, "").slice(0, 12) || "mob10";
  return `lr-${type}_${env}_${safeId}_${formatBackupStamp(date)}.${ext}`;
}
