import { mkdirSync, copyFileSync, readFileSync, readdirSync, statSync, createWriteStream } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const info = readFileSync(join(root, "src/lib/app-info.ts"), "utf8");
const version = /APP_VERSION = "([^"]+)"/.exec(info)?.[1] || "0.0.0";
mkdirSync(join(root, "artifacts"), { recursive: true });
mkdirSync(join(root, "dist-apk", "client"), { recursive: true });
const name = `LinguaReader-v${version}-source.zip`;
const dest = join(root, "artifacts", name);
const dest2 = join(root, "dist-apk", "client", name);

const include = [
  "src",
  "public",
  "scripts",
  "android/app/src",
  "android/app/build.gradle",
  "android/app/proguard-rules.pro",
  "android/app/linguareader.jks",
  "android/variables.gradle",
  "android/build.gradle",
  "android/settings.gradle",
  "android/gradle.properties",
  "android/gradlew",
  "android/gradle",
  "ios",
  "docs",
  "capacitor.config.ts",
  "capacitor.html",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "vite.capacitor.config.ts",
  "startup.sh",
  `releases/LinguaReader-AKB-v${version}.md`,
  `releases/LinguaReader-AKB-v${version}.docx`,
];

const skip = (p) =>
  p.includes("node_modules") ||
  p.includes("/build/") ||
  p.includes(".gradle") ||
  p.includes(`${join("docs", "akb")}`) ||
  p.endsWith(".DS_Store");

function walk(dir, out = []) {
  const st = statSync(dir);
  if (st.isFile()) {
    out.push(dir);
    return out;
  }
  for (const name of readdirSync(dir)) {
    const next = join(dir, name);
    if (skip(next)) continue;
    walk(next, out);
  }
  return out;
}

const files = [];
for (const item of include) {
  const abs = join(root, item);
  try {
    walk(abs, files);
  } catch {
    /* missing optional */
  }
}

const py = `
import zipfile, os, json
root = ${JSON.stringify(root)}
dest = ${JSON.stringify(dest)}
files = json.loads(${JSON.stringify(JSON.stringify(files))})
os.makedirs(os.path.dirname(dest), exist_ok=True)
with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
    for abs_path in files:
        z.write(abs_path, os.path.relpath(abs_path, root))
print(dest)
`;
const result = spawnSync("python3", ["-c", py], { cwd: root, encoding: "utf8" });
if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status || 1);
}
copyFileSync(dest, dest2);
console.log(`Source ZIP -> ${dest}`);
