import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function readAppVersion(cwd = process.cwd()) {
  try {
    const text = readFileSync(join(cwd, "src/lib/app-info.ts"), "utf8");
    return text.match(/APP_VERSION = "([^"]+)"/)?.[1] || "";
  } catch {
    return "";
  }
}

function getHtml(version) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Get LinguaReader ${version}</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Segoe UI", system-ui, sans-serif;
        background: #f2ece2;
        color: #1f2a28;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      main {
        width: min(440px, 100%);
        background: #fffaf3;
        border: 1px solid #d9cfc0;
        border-radius: 28px;
        padding: 28px 24px 24px;
        box-shadow: 0 18px 40px rgba(47, 79, 74, 0.08);
      }
      h1 { margin: 0; font-size: 1.7rem; }
      p { color: #5d6b68; line-height: 1.45; }
      a.btn {
        display: block;
        text-align: center;
        text-decoration: none;
        color: #fffaf3;
        background: #2f4f4a;
        border-radius: 16px;
        padding: 16px 14px;
        margin-top: 12px;
        font-weight: 700;
      }
      small { display: block; margin-top: 6px; font-weight: 500; opacity: 0.85; }
    </style>
  </head>
  <body>
    <main>
      <h1>Get LinguaReader</h1>
      <p>One Android file for this app version. Uninstall any older LinguaReader copy before installing this one.</p>
      <a class="btn" href="/downloads/LinguaReader.apk" download="LinguaReader-${version}.apk">
        Android phone
        <small>LinguaReader ${version} · tap to download</small>
      </a>
    </main>
  </body>
</html>
`;
}

export function writeGetHtml(cwd = process.cwd()) {
  const version = readAppVersion(cwd);
  if (!version) throw new Error("APP_VERSION missing");
  writeFileSync(join(cwd, "public", "get.html"), getHtml(version));
  return version;
}

function fileInfo(path) {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size < 1024) return null;
    return { path, size: stat.size, mtime: stat.mtimeMs };
  } catch {
    return null;
  }
}

function findApk(cwd = process.cwd()) {
  const preferred = [
    join(cwd, "android", "app", "build", "outputs", "apk", "release", "app-release.apk"),
    join(cwd, "public", "downloads", "LinguaReader.apk"),
    join(cwd, "downloads", "LinguaReader.apk"),
    join(cwd, "artifacts", "LinguaReader.apk"),
  ];
  for (const path of preferred) {
    const info = fileInfo(path);
    if (info) return { ...info, name: "LinguaReader.apk" };
  }
  return null;
}

function isApkUrl(url) {
  return /^\/downloads\/(LinguaReader(-[\d.]+)?|android)\.apk$/i.test(url) || /^\/LinguaReader(-[\d.]+)?\.apk$/i.test(url);
}

function sendFile(req, res, filePath, filename) {
  const stat = statSync(filePath);
  const size = stat.size;
  const range = String(req.headers.range || "");
  res.setHeader("Content-Type", "application/vnd.android.package-archive");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (range.startsWith("bytes=")) {
    const [startText, endText] = range.slice(6).split("-");
    const start = Number(startText);
    const end = endText ? Number(endText) : size - 1;
    if (!Number.isFinite(start) || start < 0 || start >= size) {
      res.statusCode = 416;
      res.end();
      return;
    }
    const safeEnd = Math.min(Number.isFinite(end) ? end : size - 1, size - 1);
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${safeEnd}/${size}`);
    res.setHeader("Content-Length", String(safeEnd - start + 1));
    createReadStream(filePath, { start, end: safeEnd }).pipe(res);
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Length", String(size));
  createReadStream(filePath).pipe(res);
}

function handle(req, res, next) {
  const url = decodeURIComponent((req.url || "").split("?")[0] || "");
  const version = readAppVersion();
  if (url === "/get" || url === "/get/" || url === "/get-app") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(getHtml(version));
    return;
  }
  if (!isApkUrl(url)) {
    next();
    return;
  }
  const file = findApk();
  if (!file) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("That install file is not on this server yet.");
    return;
  }
  sendFile(req, res, file.path, `LinguaReader-${version}.apk`);
}

export function downloadsPlugin() {
  return {
    name: "linguareader-downloads",
    buildStart() {
      try {
        writeGetHtml();
      } catch {
        /* pages still served dynamically in preview */
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => handle(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => handle(req, res, next));
    },
  };
}
