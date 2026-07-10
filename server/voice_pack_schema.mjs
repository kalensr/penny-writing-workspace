const OUTPUT_POLICIES = new Set(["plain_text", "journal_markdown"]);
const PROFILE_CAPABILITIES = new Set(["positioning_context"]);
const TOP_LEVEL_FIELDS = new Set([
  "schemaVersion",
  "packId",
  "name",
  "description",
  "defaultProfileId",
  "profiles",
  "analysis",
]);
const PROFILE_FIELDS = new Set([
  "id",
  "label",
  "description",
  "defaultVoiceMode",
  "outputPolicy",
  "capabilities",
  "lockedRules",
]);
const ANALYSIS_FIELDS = new Set([
  "vocabularyMarkers",
  "stanceMarkers",
  "preservationMarkers",
  "slotMarkers",
  "requiredSlotsByMode",
  "thresholds",
]);
const THRESHOLD_FIELDS = new Set([
  "vocabularyMinimum",
  "stanceMinimum",
  "cadenceSentenceMinimum",
  "cadenceStdDevMinimum",
]);

export const DEFAULT_VOICE_PACK = Object.freeze(validateVoicePack(defaultVoicePack));

export function validateVoicePack(pack) {
  if (!pack || typeof pack !== "object" || Array.isArray(pack)) throw new Error("Voice pack must be a JSON object.");
  rejectUnknownFields(pack, TOP_LEVEL_FIELDS, "voice pack");
  if (pack.schemaVersion !== 1) throw new Error("Unsupported voice pack schema version.");
  assertId(pack.packId, "packId");
  assertText(pack.name, "name");
  assertText(pack.defaultProfileId, "defaultProfileId");
  if (!Array.isArray(pack.profiles) || pack.profiles.length === 0) throw new Error("Voice pack must define profiles.");

  const profileIds = new Set();
  for (const profile of pack.profiles) {
    rejectUnknownFields(profile, PROFILE_FIELDS, `profile ${profile?.id || "unknown"}`);
    assertId(profile.id, "profile id");
    if (profileIds.has(profile.id)) throw new Error(`Duplicate style profile in pack: ${profile.id}`);
    profileIds.add(profile.id);
    assertText(profile.label, "profile label");
    assertText(profile.description, "profile description");
    assertId(profile.defaultVoiceMode, "defaultVoiceMode");
    if (!OUTPUT_POLICIES.has(profile.outputPolicy)) throw new Error(`Unknown output policy: ${profile.outputPolicy}`);
    assertStringArray(profile.lockedRules, "lockedRules", { min: 1, max: 24 });
    const capabilities = profile.capabilities || [];
    assertStringArray(capabilities, "capabilities", { min: 0, max: 8 });
    for (const capability of capabilities) {
      if (!PROFILE_CAPABILITIES.has(capability)) throw new Error(`Unknown profile capability: ${capability}`);
    }
  }
  if (!profileIds.has(pack.defaultProfileId)) throw new Error("Voice pack defaultProfileId must name a profile in the pack.");

  validateAnalysis(pack.analysis);
  return structuredClone(pack);
}

export function createVoicePackRegistry(packs) {
  if (!Array.isArray(packs) || packs.length === 0) throw new Error("At least one voice pack is required.");
  const validated = packs.map(validateVoicePack);
  const profiles = [];
  const analysisByProfile = new Map();
  const profileIds = new Set();

  for (const pack of validated) {
    for (const profile of pack.profiles) {
      if (profileIds.has(profile.id)) throw new Error(`Duplicate style profile across packs: ${profile.id}`);
      profileIds.add(profile.id);
      profiles.push(structuredClone(profile));
      analysisByProfile.set(profile.id, structuredClone(pack.analysis));
    }
  }

  return {
    packs: validated,
    profiles,
    analysisByProfile,
    defaultProfileId: validated.at(-1).defaultProfileId,
  };
}

function validateAnalysis(analysis) {
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) throw new Error("Voice pack analysis is required.");
  rejectUnknownFields(analysis, ANALYSIS_FIELDS, "analysis");
  assertStringArray(analysis.vocabularyMarkers, "vocabularyMarkers", { min: 0, max: 200 });
  assertStringArray(analysis.stanceMarkers, "stanceMarkers", { min: 0, max: 200 });
  assertStringArray(analysis.preservationMarkers, "preservationMarkers", { min: 0, max: 200 });
  validateMarkerMap(analysis.slotMarkers, "slotMarkers");
  validateMarkerMap(analysis.requiredSlotsByMode, "requiredSlotsByMode");

  if (!analysis.thresholds || typeof analysis.thresholds !== "object" || Array.isArray(analysis.thresholds)) {
    throw new Error("Voice pack thresholds are required.");
  }
  rejectUnknownFields(analysis.thresholds, THRESHOLD_FIELDS, "thresholds");
  for (const field of THRESHOLD_FIELDS) {
    const value = analysis.thresholds[field];
    if (!Number.isFinite(value) || value < 0 || value > 1000) throw new Error(`Invalid threshold: ${field}`);
  }
}

function validateMarkerMap(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  for (const [key, markers] of Object.entries(value)) {
    assertId(key, `${label} key`);
    assertStringArray(markers, `${label}.${key}`, { min: 0, max: 200 });
  }
}

function rejectUnknownFields(value, allowed, label) {
  for (const field of Object.keys(value || {})) {
    if (!allowed.has(field)) {
      const prefix = label === "analysis" ? "Unsupported analysis field" : `Unsupported ${label} field`;
      throw new Error(`${prefix}: ${field}`);
    }
  }
}

function assertId(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)) throw new Error(`Invalid ${label}.`);
}

function assertText(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 500) throw new Error(`Invalid ${label}.`);
  if (looksLikeAbsolutePath(value)) throw new Error(`${label} must not contain absolute paths.`);
}

function assertStringArray(value, label, { min, max }) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`Invalid ${label}.`);
  for (const item of value) {
    assertText(item, label);
  }
}

function looksLikeAbsolutePath(value) {
  return /(?:^|\s)\/(?:Users|home|Volumes|opt|var|etc)\//.test(value) || /[A-Za-z]:\\/.test(value);
}
import defaultVoicePack from "../voice-packs/default/voice-pack.json" with { type: "json" };
