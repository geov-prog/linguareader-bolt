import assert from "node:assert/strict";
import test from "node:test";
import { backupFileName, formatBackupStamp } from "./backupName.ts";

test("backup stamp is yymmdd-hhmm", () => {
  const stamp = formatBackupStamp(new Date(2026, 8, 25, 23, 44, 30));
  assert.equal(stamp, "260925-2344");
});

test("full Android backup matches the published pattern", () => {
  const name = backupFileName("ful", "apk", "mob1", new Date(2026, 8, 25, 23, 44));
  assert.equal(name, "lr-ful_apk_mob1_260925-2344.json");
  assert.match(name, /^lr-(ful|jrn|set|voc)_(apk|web|ios|win)_[a-z0-9-]+_\d{6}-\d{4}\.json$/);
});

test("library save uses the journal code", () => {
  const name = backupFileName("jrn", "win", "win-work", new Date(2026, 0, 2, 9, 5));
  assert.equal(name, "lr-jrn_win_win-work_260102-0905.json");
});
