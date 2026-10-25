import { copyFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeGetHtml } from "./downloads-plugin.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "artifacts"), { recursive: true });
mkdirSync(join(root, "downloads"), { recursive: true });
mkdirSync(join(root, "public", "downloads"), { recursive: true });
mkdirSync(join(root, "dist-apk", "client"), { recursive: true });

function place(source, dest) {
  if (source === dest) return;
  try {
    unlinkSync(dest);
  } catch {
    /* missing */
  }
  copyFileSync(source, dest);
}

const source = join(root, "android", "app", "build", "outputs", "apk", "release", "app-release.apk");
if (!existsSync(source)) {
  console.warn("missing Android APK");
  process.exit(1);
}

const dests = [
  join(root, "downloads", "LinguaReader.apk"),
  join(root, "artifacts", "LinguaReader.apk"),
  join(root, "public", "downloads", "LinguaReader.apk"),
  join(root, "dist-apk", "client", "LinguaReader.apk"),
];
for (const dest of dests) place(source, dest);
writeGetHtml();
console.log(`Android APK -> ${source}`);
