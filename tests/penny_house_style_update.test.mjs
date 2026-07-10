import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const updateScript = path.join(repoRoot, "scripts/update-house-style-parity.mjs");

test("House Style parity refresh pins commit, copies fixtures, and records hashes", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "penny-parity-refresh-"));
  const sourceRoot = path.join(tempRoot, "source");
  const vendorRoot = path.join(tempRoot, "vendor");
  const manifestPath = path.join(tempRoot, "manifest.json");
  const fixture = "docs/test-fixtures/example.md";
  const sourceFixture = path.join(sourceRoot, fixture);
  fs.mkdirSync(path.dirname(sourceFixture), { recursive: true });
  fs.writeFileSync(sourceFixture, "# Synthetic fixture\n\nA concrete test sentence.\n");
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify({
      schemaVersion: 1,
      sourceRepo: "house-style-system",
      sourceCommit: "old",
      cases: [{ canonicalRuleId: "Synthetic.Rule", canonicalFixture: fixture, sha256: "0".repeat(64) }],
    }, null, 2)}\n`,
  );

  const result = runRefresh(sourceRoot, manifestPath, vendorRoot, "abc123");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(vendorRoot, fixture), "utf8"), fs.readFileSync(sourceFixture, "utf8"));
  const refreshed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(refreshed.sourceCommit, "abc123");
  assert.equal(refreshed.cases[0].sha256, sha256(fs.readFileSync(sourceFixture)));
});

test("House Style parity refresh rejects fixture paths outside the source root", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "penny-parity-escape-"));
  const sourceRoot = path.join(tempRoot, "source");
  const vendorRoot = path.join(tempRoot, "vendor");
  const manifestPath = path.join(tempRoot, "manifest.json");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify({
      schemaVersion: 1,
      sourceRepo: "house-style-system",
      sourceCommit: "old",
      cases: [{ canonicalRuleId: "Unsafe.Rule", canonicalFixture: "../outside.md", sha256: "0".repeat(64) }],
    }, null, 2)}\n`,
  );

  const result = runRefresh(sourceRoot, manifestPath, vendorRoot, "abc123");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fixture path must stay inside the source root/i);
});

function runRefresh(sourceRoot, manifestPath, vendorRoot, sourceCommit) {
  return spawnSync(process.execPath, [updateScript, sourceRoot], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HOUSE_STYLE_SOURCE_COMMIT: sourceCommit,
      PENNY_PARITY_MANIFEST: manifestPath,
      PENNY_PARITY_VENDOR_ROOT: vendorRoot,
    },
  });
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
