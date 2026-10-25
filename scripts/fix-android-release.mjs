import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readAppVersion } from "./downloads-plugin.mjs";

const root = process.cwd();
const version = readAppVersion(root);
const gradlePath = join(root, "android/app/build.gradle");
let gradle = readFileSync(gradlePath, "utf8");
gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${version}"`);
const parts = version.split(".").map((n) => Number(n) || 0);
const code = (parts[0] || 0) * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${code}`);
writeFileSync(gradlePath, gradle);

const capGradle = join(root, "android/app/capacitor.build.gradle");
writeFileSync(capGradle, readFileSync(capGradle, "utf8").replaceAll("VERSION_21", "VERSION_17"));

writeFileSync(
  join(root, "android/app/src/main/res/values/strings.xml"),
  `<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="app_name">LinguaReader</string>
    <string name="title_activity_main">LinguaReader</string>
    <string name="package_name">com.linguareader.app</string>
    <string name="custom_url_scheme">com.linguareader.app</string>
    <string name="reading_channel">Reading</string>
    <string name="reading_notice">Reading in the background</string>
</resources>
`,
);

console.log(`Android label LinguaReader · ${version} (${code})`);
