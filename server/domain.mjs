import { DEFAULT_VOICE_PACK } from "./voice_pack_schema.mjs";

export const WORKSPACE_SCHEMA_VERSION = 2;
export const MAX_PENNY_RESPONSE_CANDIDATES = 8;
export let DEFAULT_STYLE_PROFILE_ID = DEFAULT_VOICE_PACK.defaultProfileId;
export const POSITIONING_CONTEXT_KEYS = [
  "targetRoleFamily",
  "opportunityType",
  "audience",
  "posture",
  "evidenceEmphasis",
  "boundaries",
];

const PENNY_MODES = [
  {
    id: "draft_from_notes",
    label: "Draft from notes",
    shortLabel: "Draft",
    description: "Turn notes into a first pass.",
    runtimeProfile: "daily",
    profile: "daily",
    instruction: "Turn rough notes into a clear first draft. Keep claims grounded in the supplied material.",
  },
  {
    id: "revise_clarity",
    label: "Revise for clarity",
    shortLabel: "Clarity",
    description: "Tighten structure and wording.",
    runtimeProfile: "daily",
    profile: "daily",
    instruction: "Make the draft clearer, more direct, and easier to scan without adding unsupported claims.",
  },
  {
    id: "preserve_voice",
    label: "Preserve voice",
    shortLabel: "Voice",
    description: "Improve while keeping cadence.",
    runtimeProfile: "daily",
    profile: "daily",
    instruction: "Improve the writing while preserving the author's natural cadence, plain language, and point of view.",
  },
  {
    id: "critique",
    label: "Critique",
    shortLabel: "Critique",
    description: "Find weak logic and friction.",
    runtimeProfile: "daily",
    profile: "daily",
    instruction: "Review the draft for weak logic, missing specificity, vague language, and reader friction.",
  },
  {
    id: "expand",
    label: "Expand",
    shortLabel: "Expand",
    description: "Add useful detail without filler.",
    runtimeProfile: "daily",
    profile: "daily",
    instruction: "Expand the selected idea with concrete detail, useful structure, and no filler.",
  },
  {
    id: "compress",
    label: "Compress",
    shortLabel: "Compress",
    description: "Shorten while preserving meaning.",
    runtimeProfile: "daily",
    profile: "daily",
    instruction: "Shorten the draft while preserving meaning, useful specificity, and the author's voice.",
  },
  {
    id: "outline",
    label: "Outline",
    shortLabel: "Outline",
    description: "Shape the next version.",
    runtimeProfile: "daily",
    profile: "daily",
    instruction: "Create a practical outline that helps the writer decide what to write next.",
  },
  {
    id: "title_lede",
    label: "Title and lede",
    shortLabel: "Title/Lede",
    description: "Generate openings and names.",
    runtimeProfile: "daily",
    profile: "daily",
    instruction: "Offer title and opening options that are specific, grounded, and not clickbait.",
  },
  {
    id: "quality_review",
    label: "Quality review",
    shortLabel: "Quality",
    description: "Slow second-reader pass.",
    runtimeProfile: "quality",
    profile: "quality",
    instruction: "Act as a slower second reader. Identify the highest-leverage improvements before rewriting.",
  },
];

let STYLE_PROFILES = structuredClone(DEFAULT_VOICE_PACK.profiles);

export function configureStyleProfiles(profiles, defaultProfileId) {
  if (!Array.isArray(profiles) || profiles.length === 0) throw new Error("Penny requires at least one style profile.");
  const ids = new Set();
  for (const profile of profiles) {
    if (!profile?.id || ids.has(profile.id)) throw new Error(`Invalid or duplicate style profile: ${profile?.id || "unknown"}`);
    ids.add(profile.id);
  }
  if (!ids.has(defaultProfileId)) throw new Error(`Unknown default style profile: ${defaultProfileId}`);
  STYLE_PROFILES = structuredClone(profiles);
  DEFAULT_STYLE_PROFILE_ID = defaultProfileId;
}

export function listPennyModes() {
  return PENNY_MODES.map((mode) => ({ ...mode }));
}

export function getPennyMode(modeId) {
  const mode = PENNY_MODES.find((candidate) => candidate.id === modeId);
  if (!mode) {
    throw new Error(`Unknown Penny mode: ${modeId}`);
  }
  return { ...mode };
}

export function listStyleProfiles() {
  return STYLE_PROFILES.map((profile) => ({ ...profile, lockedRules: [...profile.lockedRules] }));
}

export function getStyleProfile(profileId = DEFAULT_STYLE_PROFILE_ID) {
  const profile = STYLE_PROFILES.find((candidate) => candidate.id === profileId);
  if (!profile) {
    throw new Error(`Unknown Penny style profile: ${profileId}`);
  }
  return { ...profile, lockedRules: [...profile.lockedRules] };
}

export function resolveStyleProfile(profileId = DEFAULT_STYLE_PROFILE_ID) {
  const requestedId = String(profileId || DEFAULT_STYLE_PROFILE_ID);
  const profile = STYLE_PROFILES.find((candidate) => candidate.id === requestedId);
  if (profile) return { requestedId, available: true, profile: getStyleProfile(requestedId) };
  return { requestedId, available: false, profile: getStyleProfile(DEFAULT_STYLE_PROFILE_ID) };
}

export function defaultWorkspace() {
  return normalizeWorkspace({
    activeProjectId: "project-writing-desk",
    activeDocumentId: "doc-quarterly-ai-adoption-memo",
    selectedModeId: "revise_clarity",
    instruction: "",
    selectedText: "",
    projects: [
      {
        id: "project-writing-desk",
        name: "Writing desk",
        documents: [
          {
            id: "doc-quarterly-ai-adoption-memo",
            title: "Quarterly AI Adoption Memo",
            writingType: "executive memo",
            body:
              "I want this memo to explain how I use local model work, where the model is not ready, and which operating boundaries keep the writing workflow trustworthy.",
            updatedAt: new Date(0).toISOString(),
          },
        ],
      },
    ],
    pennyTurns: [],
  });
}

export function normalizeWorkspace(workspace = {}) {
  const projects = Array.isArray(workspace.projects) && workspace.projects.length ? workspace.projects : [];
  const normalizedProjects = projects.map((project, projectIndex) => {
    const documents = Array.isArray(project.documents) ? project.documents : [];
    return {
      id: project.id || `project-${projectIndex + 1}`,
      name: project.name || "Writing desk",
      documents: documents.map((document, documentIndex) => normalizeDocument(document, documentIndex)),
    };
  });

  if (!normalizedProjects.length) {
    normalizedProjects.push({
      id: "project-writing-desk",
      name: "Writing desk",
      documents: [
        normalizeDocument(
          {
            id: "doc-quarterly-ai-adoption-memo",
            title: "Quarterly AI Adoption Memo",
            writingType: "executive memo",
            body:
              "I want this memo to explain how I use local model work, where the model is not ready, and which operating boundaries keep the writing workflow trustworthy.",
            updatedAt: new Date(0).toISOString(),
          },
          0,
        ),
      ],
    });
  }

  const activeProjectId = normalizedProjects.some((project) => project.id === workspace.activeProjectId)
    ? workspace.activeProjectId
    : normalizedProjects[0].id;
  const activeProject = normalizedProjects.find((project) => project.id === activeProjectId);
  const activeDocumentId = activeProject.documents.some((document) => document.id === workspace.activeDocumentId)
    ? workspace.activeDocumentId
    : activeProject.documents[0]?.id || null;

  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    activeProjectId,
    activeDocumentId,
    selectedModeId: safeModeId(workspace.selectedModeId),
    instruction: typeof workspace.instruction === "string" ? workspace.instruction : "",
    selectedText: "",
    selectionStart: null,
    selectionEnd: null,
    projects: normalizedProjects,
    pennyTurns: Array.isArray(workspace.pennyTurns) ? workspace.pennyTurns : [],
  };
}

function normalizeDocument(document = {}, index = 0) {
  return {
    id: document.id || `doc-${index + 1}`,
    title: document.title || "Untitled",
    writingType: document.writingType || "draft",
    body: typeof document.body === "string" ? document.body : "",
    styleProfileId: safeStyleProfileId(document.styleProfileId),
    positioningContext: normalizePositioningContext(document.positioningContext),
    pennyResponses: normalizePennyResponses(document.pennyResponses),
    updatedAt: document.updatedAt || new Date(0).toISOString(),
  };
}

function normalizePennyResponses(responses = []) {
  if (!Array.isArray(responses)) return [];
  const normalized = responses
    .filter((response) => response && typeof response.content === "string" && response.content.trim())
    .map((response, index) => ({
      id: String(response.id || `response-${index + 1}`),
      content: response.content,
      modeId: safeModeId(response.modeId),
      styleProfileId: safeStyleProfileId(response.styleProfileId),
      applyMode: response.applyMode || null,
      revisionScope: response.revisionScope || null,
      pinned: Boolean(response.pinned),
      createdAt: response.createdAt || new Date(0).toISOString(),
      context: response.context || null,
      sourceResponse: response.sourceResponse || null,
      inlineAnnotations: Array.isArray(response.inlineAnnotations) ? response.inlineAnnotations : undefined,
      responseStyleReport: response.responseStyleReport || undefined,
      sourceStyleReport: response.sourceStyleReport || undefined,
    }));
  if (normalized.length <= MAX_PENNY_RESPONSE_CANDIDATES) return normalized;
  const pinned = normalized.filter((response) => response.pinned);
  const unpinned = normalized.filter((response) => !response.pinned);
  return [...pinned, ...unpinned].slice(0, MAX_PENNY_RESPONSE_CANDIDATES);
}

export function normalizePositioningContext(positioningContext = {}) {
  return POSITIONING_CONTEXT_KEYS.reduce((normalized, key) => {
    normalized[key] = String(positioningContext?.[key] || "").trim();
    return normalized;
  }, {});
}

function safeModeId(modeId) {
  return PENNY_MODES.some((mode) => mode.id === modeId) ? modeId : "revise_clarity";
}

function safeStyleProfileId(styleProfileId) {
  return typeof styleProfileId === "string" && styleProfileId.trim()
    ? styleProfileId.trim()
    : DEFAULT_STYLE_PROFILE_ID;
}
