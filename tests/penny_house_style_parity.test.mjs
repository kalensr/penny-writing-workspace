import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { analyzeVoice } from "../server/voice_rules.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(repoRoot, "docs/protocol/penny-house-style-parity-manifest.json");
const vendoredFixtureRoot = path.join(repoRoot, "tests/fixtures/house-style/v0.1.0");
const houseStyleRoot = process.env.HOUSE_STYLE_SYSTEM_DIR || vendoredFixtureRoot;

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

test("Penny house-style parity manifest has stable contract metadata", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.sourceRepo, "house-style-system");
  assert.equal(manifest.sourceCommit, "856b4a7acf241e3b6dc8312f5f92bde3816e4e0b");
  assert.ok(manifest.sourceRootHint.includes("house-style-system"));
  assert.ok(Array.isArray(manifest.cases));
  assert.ok(manifest.cases.length >= 10);

  const canonicalRuleIds = new Set();
  for (const parityCase of manifest.cases) {
    assertManifestField(parityCase, "canonicalRuleId");
    assertManifestField(parityCase, "canonicalFixture");
    assertManifestField(parityCase, "pennyLayer");
    assertManifestField(parityCase, "pennyRuleId");
    assertManifestField(parityCase, "expectedSeverity");
    assertManifestField(parityCase, "expectedBehavior");
    assert.match(parityCase.sha256, /^[a-f0-9]{64}$/);
    assert.equal(
      canonicalRuleIds.has(parityCase.canonicalRuleId),
      false,
      `${parityCase.canonicalRuleId} should appear once in the parity manifest`,
    );
    canonicalRuleIds.add(parityCase.canonicalRuleId);
  }
});

for (const parityCase of manifest.cases) {
  test(`Penny mirrors canonical house-style fixture: ${parityCase.canonicalRuleId}`, () => {
    const sourcePath = path.join(houseStyleRoot, parityCase.canonicalFixture);
    assert.equal(
      existsSync(sourcePath),
      true,
      `${parityCase.canonicalFixture} must exist in ${houseStyleRoot}`,
    );

    assert.equal(
      sha256(readFileSync(sourcePath)),
      parityCase.sha256,
      `${parityCase.canonicalFixture} must match the pinned fixture hash`,
    );

    const text = fixtureBody(readFileSync(sourcePath, "utf8"));
    const report = analyzeVoice(text, {
      writingType: parityCase.writingType || "executive memo",
      modeId: parityCase.modeId || "critique",
      styleProfileId: parityCase.styleProfileId || "executive",
    });
    const finding = report.violations.find((violation) => violation.ruleId === parityCase.pennyRuleId);

    assert.ok(
      finding,
      `${parityCase.canonicalRuleId} should map to ${parityCase.pennyRuleId}; got ${report.violations
        .map((violation) => violation.ruleId)
        .join(", ")}`,
    );
    assert.equal(finding.layer, parityCase.pennyLayer);
    assert.equal(finding.severity, parityCase.expectedSeverity);

    if (parityCase.expectedBehavior === "advisory") {
      assert.equal(finding.severity, "minor");
    }
  });
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

for (const parityCase of manifest.cases.filter((entry) => entry.profileExceptions?.length)) {
  for (const profile of parityCase.profileExceptions) {
    test(`Penny honors ${profile} exception for ${parityCase.canonicalRuleId}`, () => {
      const sourcePath = path.join(houseStyleRoot, parityCase.canonicalFixture);
      const text = fixtureBody(readFileSync(sourcePath, "utf8"));
      const report = analyzeVoice(text, {
        writingType: "journal",
        modeId: "preserve_voice",
        styleProfileId: profile,
      });

      assert.equal(
        report.violations.some((violation) => violation.ruleId === parityCase.pennyRuleId),
        false,
      );
    });
  }
}

function fixtureBody(markdown) {
  return String(markdown || "")
    .replace(/^\s*# .*(?:\r?\n){1,2}/, "")
    .trim();
}

function assertManifestField(parityCase, field) {
  assert.equal(
    typeof parityCase[field],
    "string",
    `${parityCase.canonicalRuleId || "unnamed parity case"} must declare ${field}`,
  );
  assert.notEqual(parityCase[field].trim(), "", `${parityCase.canonicalRuleId} must not leave ${field} blank`);
}
