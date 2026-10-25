import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readAppVersion } from "./downloads-plugin.mjs";

const root = process.cwd();
const errors = [];

function fail(msg) {
  errors.push(msg);
}

function read(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function unzipText(apkPath, inner) {
  const result = spawnSync(
    "python3",
    ["-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); sys.stdout.buffer.write(z.read(sys.argv[2]))", apkPath, inner],
    { maxBuffer: 20 * 1024 * 1024 },
  );
  if (result.status !== 0) return "";
  return result.stdout.toString("utf8");
}

function unzipNames(apkPath) {
  const result = spawnSync(
    "python3",
    ["-c", "import sys,zipfile; print('\\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))", apkPath],
    { maxBuffer: 2 * 1024 * 1024 },
  );
  return result.status === 0 ? result.stdout.toString("utf8").split("\n").filter(Boolean) : [];
}

const version = readAppVersion(root);
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`APP_VERSION is missing or invalid: ${version}`);

const gradle = read(join(root, "android/app/build.gradle"));
if (!gradle.includes(`versionName "${version}"`)) {
  fail(`android/app/build.gradle versionName is not ${version}`);
}

const getHtml = read(join(root, "public/get.html"));
if (!getHtml.includes(`LinguaReader ${version}`)) fail(`public/get.html is not ${version}`);
if (getHtml.includes("1.2.0") && version !== "1.2.0") fail("stale 1.2.0 label in get.html");

const src = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path);
    else if (/\.(tsx|ts)$/.test(name)) src.push(path);
  }
}
walk(join(root, "src"));
const apkButtons = src.filter((path) => /openInstallFile\(ANDROID_APK_HREF/.test(read(path)));
if (apkButtons.length < 1 || apkButtons.length > 2) {
  fail(`expected 1–2 Android APK buttons in src, found ${apkButtons.length}: ${apkButtons.join(", ")}`);
}

const apkPath = join(root, "android/app/build/outputs/apk/release/app-release.apk");
const publicApk = join(root, "public/downloads/LinguaReader.apk");
const strict = process.argv.includes("--strict");
const checkApk = existsSync(apkPath) ? apkPath : existsSync(publicApk) ? publicApk : "";
if (!checkApk) {
  if (strict) fail("release APK missing — build android first");
} else {
  const bytes = readFileSync(checkApk);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) fail("release APK is not a zip/apk");
  if (bytes.length < 4_000_000 || bytes.length > 40_000_000) fail(`APK size looks wrong: ${bytes.length}`);
  const names = unzipNames(checkApk);
  if (!names.includes("assets/public/index.html")) fail("APK missing assets/public/index.html");
  const html = unzipText(checkApk, "assets/public/index.html");
  if (!html.includes('id="root"')) fail("APK index.html has no #root (blank screen)");
  if (!html.includes("<script")) fail("APK index.html has no script");
  const scriptMatch = html.match(/src="\.\/assets\/([^"]+\.js)"/);
  if (!scriptMatch) fail("APK index.html does not load a JS bundle");
  else {
    const jsName = `assets/public/assets/${scriptMatch[1]}`;
    const js = unzipText(checkApk, jsName);
    if (!js.includes("LinguaReader")) fail("APK bundle does not contain LinguaReader");
    if (!js.includes(version)) fail(`APK bundle does not contain ${version}`);
  }
  if (names.some((n) => n.includes("downloads/") && n.endsWith(".apk"))) {
    fail("APK contains a nested APK under assets — that was the old 1.2.0/blank download");
  }
}

if (existsSync(publicApk) && existsSync(apkPath)) {
  const a = readFileSync(apkPath);
  const b = readFileSync(publicApk);
  if (a.length !== b.length) fail("public/downloads APK does not match the release APK");
}

if (errors.length) {
  console.error("Release validation failed:");
  for (const err of errors) console.error(" -", err);
  process.exit(1);
}

console.log(`Release OK · LinguaReader ${version}`);
