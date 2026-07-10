import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  configureStyleProfiles,
  defaultWorkspace,
  listStyleProfiles,
  normalizeWorkspace,
  resolveStyleProfile,
} from "../server/domain.mjs";
import { loadVoicePackConfiguration } from "../server/voice_pack_loader.mjs";
import {
  DEFAULT_VOICE_PACK,
  createVoicePackRegistry,
  validateVoicePack,
} from "../server/voice_pack_schema.mjs";
import { analyzeVoice, configureVoiceAnalysis } from "../server/voice_rules.mjs";

test("Penny ships a generic built-in voice pack", () => {
  const serialized = JSON.stringify(DEFAULT_VOICE_PACK);
  assert.doesNotMatch(serialized, /private-name-marker|private-belief-marker|private-tailnet-marker/i);
  assert.deepEqual(
    DEFAULT_VOICE_PACK.profiles.map((profile) => profile.id),
    ["reflective", "executive", "raw-journal"],
  );
  assert.equal(DEFAULT_VOICE_PACK.defaultProfileId, "reflective");
});

test("Penny loads data-only JSON packs and selects the external default", () => {
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "penny-voice-pack-"));
  fs.writeFileSync(path.join(packDir, "example.json"), `${JSON.stringify(examplePack(), null, 2)}\n`);

  const config = loadVoicePackConfiguration({ packDir });

  assert.equal(config.defaultProfileId, "example-reflective");
  assert.ok(config.profiles.some((profile) => profile.id === "reflective"));
  assert.ok(config.profiles.some((profile) => profile.id === "example-reflective"));
  assert.deepEqual(config.analysisByProfile.get("example-reflective").preservationMarkers, ["source promise"]);
  assert.deepEqual(config.warnings, []);
});

test("Penny falls back to the generic pack when an optional pack directory is missing", () => {
  const config = loadVoicePackConfiguration({ packDir: path.join(os.tmpdir(), "penny-missing-pack") });
  assert.equal(config.defaultProfileId, "reflective");
  assert.equal(config.warnings.length, 1);
  assert.match(config.warnings[0], /not found/i);
});

test("Penny rejects unsafe pack data and duplicate profile ids", () => {
  const unsafe = examplePack();
  unsafe.analysis.vocabularyMarkers = ["/opt/example/private.txt"];
  assert.throws(() => validateVoicePack(unsafe), /absolute paths/i);

  const duplicate = examplePack();
  duplicate.profiles[0].id = "reflective";
  duplicate.defaultProfileId = "reflective";
  assert.throws(() => createVoicePackRegistry([DEFAULT_VOICE_PACK, duplicate]), /duplicate style profile/i);

  const unsupported = examplePack();
  unsupported.analysis.regexPatterns = [".*"];
  assert.throws(() => validateVoicePack(unsupported), /unsupported analysis field/i);
});

test("Penny preserves unavailable saved profile ids without making them selectable", () => {
  configureStyleProfiles(DEFAULT_VOICE_PACK.profiles, DEFAULT_VOICE_PACK.defaultProfileId);
  const workspace = defaultWorkspace();
  workspace.projects[0].documents[0].styleProfileId = "private-profile-not-loaded";

  const normalized = normalizeWorkspace(workspace);
  const resolved = resolveStyleProfile(normalized.projects[0].documents[0].styleProfileId);

  assert.equal(normalized.projects[0].documents[0].styleProfileId, "private-profile-not-loaded");
  assert.equal(resolved.available, false);
  assert.equal(resolved.requestedId, "private-profile-not-loaded");
  assert.equal(resolved.profile.id, "reflective");
  assert.equal(listStyleProfiles().some((profile) => profile.id === "private-profile-not-loaded"), false);
});

test("Penny evaluates an external profile with declarative preservation markers", () => {
  const registry = createVoicePackRegistry([DEFAULT_VOICE_PACK, examplePack()]);
  configureStyleProfiles(registry.profiles, registry.defaultProfileId);
  configureVoiceAnalysis(registry.analysisByProfile);

  const report = analyzeVoice("I think the next step is to decide.", {
    styleProfileId: "example-reflective",
    sourceText: "The source promise shaped the question and next step.",
  });

  assert.equal(report.styleProfile.id, "example-reflective");
  assert.ok(report.violations.some((violation) => violation.ruleId === "Voice.Preservation.Lost"));
  assert.deepEqual(report.features.sourcePreservationHits, ["source promise"]);

  const defaults = createVoicePackRegistry([DEFAULT_VOICE_PACK]);
  configureStyleProfiles(defaults.profiles, defaults.defaultProfileId);
  configureVoiceAnalysis(defaults.analysisByProfile);
});

function examplePack() {
  return {
    schemaVersion: 1,
    packId: "example-pack",
    name: "Example pack",
    defaultProfileId: "example-reflective",
    profiles: [
      {
        id: "example-reflective",
        label: "Example reflective",
        description: "Synthetic external profile.",
        defaultVoiceMode: "reflective",
        outputPolicy: "plain_text",
        capabilities: [],
        lockedRules: ["Keep the source promise visible."],
      },
    ],
    analysis: {
      vocabularyMarkers: ["decision", "action"],
      stanceMarkers: ["i think"],
      preservationMarkers: ["source promise"],
      slotMarkers: {
        tension: ["question"],
        reflection: ["i think"],
        action: ["next step"],
      },
      requiredSlotsByMode: {
        reflective: ["tension", "reflection", "action"],
      },
      thresholds: {
        vocabularyMinimum: 1,
        stanceMinimum: 1,
        cadenceSentenceMinimum: 6,
        cadenceStdDevMinimum: 4,
      },
    },
  };
}
