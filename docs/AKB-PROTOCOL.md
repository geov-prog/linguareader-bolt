# LinguaReader AKB protocol

On **every** product instruction, keep these outputs on the **same version**:

| Artifact | Path |
|---|---|
| AKB Markdown | `/workspace/LinguaReader-AKB-vX.md` |
| AKB Word | `/workspace/LinguaReader-AKB-vX.docx` |
| Android APK | `/workspace/dist-apk/client/LinguaReader.apk` |
| Source ZIP | `/workspace/artifacts/LinguaReader-vX-source.zip` |

Rules:

1. Bump `APP_VERSION` and `APP_VERSION_CODE` in `src/lib/app-info.ts` when behavior or packaging changes.
2. Append an entry to the AKB Change Log (never rewrite history).
3. Highlight what changed vs the previous AKB version.
4. Rebuild the signed APK (`npm run pack:android`) so `dist-apk/client` matches the version.
5. Rebuild the source ZIP.
6. Do not change `applicationId` (`com.linguareader.app`), IndexedDB name (`linguareader`), or enable unused Auth/DB scaffolds.
7. Backup JSON v3 must include `settingsDesktop` and `settingsMobile`.
