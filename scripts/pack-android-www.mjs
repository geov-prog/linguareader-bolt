import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const dest = join(root, "android-www");
const result = spawnSync("npx", ["vite", "build", "--config", "vite.capacitor.config.ts"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
if (result.status !== 0) {
  throw new Error("Capacitor web build failed.");
}

const built = join(dest, "capacitor.html");
if (existsSync(built)) {
  renameSync(built, join(dest, "index.html"));
}

for (const name of ["favicon.svg", "apple-touch-icon.png", "pwa-192x192.png", "pwa-512x512.png", "pwa-512x512-maskable.png", "og.jpg"]) {
  const from = join(root, "public", name);
  if (existsSync(from)) cpSync(from, join(dest, name));
}

const pdfjs = join(root, "public", "pdfjs");
if (existsSync(pdfjs)) {
  mkdirSync(join(dest, "pdfjs"), { recursive: true });
  cpSync(pdfjs, join(dest, "pdfjs"), { recursive: true });
}

rmSync(join(dest, "downloads"), { recursive: true, force: true });
rmSync(join(dest, "get.html"), { force: true });

if (!existsSync(join(dest, "index.html"))) {
  throw new Error("android-www is missing index.html");
}
const html = readFileSync(join(dest, "index.html"), "utf8");
if (!html.includes('id="root"') || !html.includes("<script")) {
  throw new Error("android-www/index.html would boot to a blank screen");
}
console.log("android-www ready (standalone Capacitor build, no nested APK)");
