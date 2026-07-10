#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.resolve(process.argv[2] || process.env.HOUSE_STYLE_SYSTEM_DIR || path.join(repoRoot, "../house-style-system"));
const manifestPath = path.resolve(
  process.env.PENNY_PARITY_MANIFEST || path.join(repoRoot, "docs/protocol/penny-house-style-parity-manifest.json"),
);
const vendorRoot = path.resolve(
  process.env.PENNY_PARITY_VENDOR_ROOT || path.join(repoRoot, "tests/fixtures/house-style/v0.1.0"),
);

try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const sourceCommit =
    process.env.HOUSE_STYLE_SOURCE_COMMIT ||
    execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

  for (const parityCase of manifest.cases || []) {
    const relativePath = String(parityCase.canonicalFixture || "");
    const sourcePath = resolveInside(sourceRoot, relativePath);
    const targetPath = resolveInside(vendorRoot, relativePath);
    const bytes = fs.readFileSync(sourcePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, bytes);
    parityCase.sha256 = sha256(bytes);
  }

  manifest.sourceCommit = sourceCommit;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`penny_house_style_parity.updated=${manifest.cases.length}\n`);
  process.stdout.write(`penny_house_style_parity.source_commit=${sourceCommit}\n`);
} catch (error) {
  process.stderr.write(`penny_house_style_parity.error=${error.message}\n`);
  process.exitCode = 1;
}

function resolveInside(root, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error("Fixture path must stay inside the source root.");
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Fixture path must stay inside the source root.");
  }
  return resolved;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
