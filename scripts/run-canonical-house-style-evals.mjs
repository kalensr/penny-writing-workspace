#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.resolve(
  process.argv[2] || process.env.HOUSE_STYLE_SYSTEM_DIR || path.join(repoRoot, "../house-style-system"),
);

export const canonicalSuites = [
  "scripts/eval-kalen-voice.sh",
  "scripts/eval-ai-voice.sh",
  "scripts/eval-center-of-gravity.sh",
  "scripts/eval-dramatic-punctuation.sh",
];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCanonicalSuites(sourceRoot);
}

export function runCanonicalSuites(root) {
  for (const relativePath of canonicalSuites) {
    const script = resolveInside(root, relativePath);
    if (!fs.existsSync(script)) {
      throw new Error(`Canonical house-style suite is missing: ${relativePath}`);
    }
    const output = execFileSync(script, [], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    process.stdout.write(output);
  }
  process.stdout.write(`canonical_house_style_evals.passed=${canonicalSuites.length}\n`);
}

function resolveInside(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Canonical suite path escaped the house-style repository.");
  }
  return resolved;
}
