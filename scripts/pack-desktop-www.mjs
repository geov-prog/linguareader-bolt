import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dest = join(root, "desktop", "www");
const iconDest = join(root, "desktop", "icon.png");
const sources = [join(root, "android-www"), join(root, ".vercel", "output", "static")];
const source = sources.find((dir) => existsSync(join(dir, "index.html")) || existsSync(join(dir, "assets")));
if (!source) {
  throw new Error("No built web files found. Publish the web app first.");
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(source, dest, { recursive: true });

const iconSrc = existsSync(join(root, "public", "pwa-512x512.png"))
  ? join(root, "public", "pwa-512x512.png")
  : join(source, "pwa-512x512.png");
if (existsSync(iconSrc)) cpSync(iconSrc, iconDest);

if (!existsSync(join(dest, "index.html"))) {
  throw new Error("desktop/www is missing index.html");
}
console.log(`desktop/www packed from ${source}`);
