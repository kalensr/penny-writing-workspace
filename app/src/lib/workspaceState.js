import {
  DEFAULT_STYLE_PROFILE_ID,
  MAX_PENNY_RESPONSE_CANDIDATES,
  normalizePositioningContext,
  defaultWorkspace,
  getPennyMode,
  getStyleProfile,
  normalizeWorkspace,
} from "../../../server/domain.mjs";

const ARTIFACT_CONTEXT_KEYS = [
  "documentId",
  "modeId",
  "styleProfileId",
  "draftFingerprint",
  "positioningFingerprint",
  "selectedText",
  "selectionStart",
  "selectionEnd",
  "instruction",
];

const ARTIFACT_REASON_LABELS = {
  documentId: "document",
  modeId: "mode",
  styleProfileId: "style profile",
  draftFingerprint: "draft",
  positioningFingerprint: "positioning context",
  selectedText: "selection",
  selectionStart: "selection",
  selectionEnd: "selection",
  instruction: "instruction",
};

export function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createInitialWorkspace() {
  return {
    ...defaultWorkspace(),
    pennyTurns: [
      {
        id: "turn-welcome",
        role: "penny",
        modeId: "revise_clarity",
        content:
          "I can help shape this into a clearer memo, keep your voice intact, or switch into quality review when you want a slower second pass.",
        createdAt: new Date(0).toISOString(),
      },
    ],
  };
}

function mapProjects(workspace, callback) {
  return {
    ...workspace,
    projects: workspace.projects.map((project) =>
      project.id === workspace.activeProjectId ? callback(project) : project,
    ),
  };
}

export function getActiveDocument(workspace) {
  const project = workspace.projects.find((candidate) => candidate.id === workspace.activeProjectId);
  return project?.documents.find((document) => document.id === workspace.activeDocumentId);
}

function getDocumentById(workspace, documentId) {
  const project = workspace.projects.find((candidate) => candidate.id === workspace.activeProjectId);
  return project?.documents.find((document) => document.id === documentId);
}

function updateDocument(workspace, documentId, callback) {
  return mapProjects(workspace, (project) => ({
    ...project,
    documents: project.documents.map((document) => (document.id === documentId ? callback(document) : document)),
  }));
}

export function draftFingerprint(value = "") {
  const text = String(value);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return `${text.length}:${hash.toString(16)}`;
}

function positioningFingerprint(positioningContext = {}) {
  return draftFingerprint(JSON.stringify(normalizePositioningContext(positioningContext)));
}

export function buildPennyArtifactContext(workspace, document = getActiveDocument(workspace)) {
  return {
    documentId: document?.id || null,
    modeId: workspace.selectedModeId,
    styleProfileId: document?.styleProfileId || DEFAULT_STYLE_PROFILE_ID,
    draftFingerprint: draftFingerprint(document?.body || ""),
    positioningFingerprint: positioningFingerprint(document?.positioningContext),
    selectedText: workspace.selectedText || "",
    selectionStart: Number.isInteger(workspace.selectionStart) ? workspace.selectionStart : null,
    selectionEnd: Number.isInteger(workspace.selectionEnd) ? workspace.selectionEnd : null,
    instruction: workspace.instruction || "",
  };
}

function sameArtifactContext(left, right) {
  return Boolean(left && right) && ARTIFACT_CONTEXT_KEYS.every((key) => left[key] === right[key]);
}

export function getArtifactFreshness(artifact, workspace, document = getActiveDocument(workspace)) {
  if (!artifact?.context) {
    return { fresh: false, reasons: ["missing context"] };
  }
  const current = buildPennyArtifactContext(workspace, document);
  const reasons = [
    ...new Set(
      ARTIFACT_CONTEXT_KEYS.filter((key) => artifact.context[key] !== current[key]).map(
        (key) => ARTIFACT_REASON_LABELS[key] || key,
      ),
    ),
  ];
  return {
    fresh: reasons.length === 0,
    reasons,
  };
}

export function isPennyArtifactFresh(artifact, workspace) {
  return getArtifactFreshness(artifact, workspace).fresh;
}

export function setSelectionFocus(workspace, selection = {}) {
  const text = String(selection.text || "");
  if (!text) return clearSelectionFocus(workspace);
  return {
    ...workspace,
    selectedText: text,
    selectionStart: Number.isInteger(selection.start) ? selection.start : null,
    selectionEnd: Number.isInteger(selection.end) ? selection.end : null,
  };
}

export function clearSelectionFocus(workspace) {
  return {
    ...workspace,
    selectedText: "",
    selectionStart: null,
    selectionEnd: null,
  };
}

export function createDocument(workspace, { title, writingType }) {
  const id = `doc-${slugify(title || "untitled") || Date.now()}`;
  const document = {
    id,
    title: title || "Untitled",
    writingType: writingType || "draft",
    body: "",
    styleProfileId: DEFAULT_STYLE_PROFILE_ID,
    positioningContext: normalizePositioningContext(),
    updatedAt: new Date().toISOString(),
  };

  return {
    ...mapProjects(workspace, (project) => ({
      ...project,
      documents: [...project.documents, document],
    })),
    activeDocumentId: id,
  };
}

export function updateDocumentText(workspace, documentId, body) {
  return mapProjects(workspace, (project) => ({
    ...project,
    documents: project.documents.map((document) =>
      document.id === documentId
        ? {
            ...document,
            body,
            updatedAt: new Date().toISOString(),
          }
        : document,
    ),
  }));
}

export function createPennyUndoSnapshot(workspace, documentId, label = "Penny change") {
  const document = getDocumentById(workspace, documentId);
  if (!document) {
    throw new Error(`Unknown Penny document: ${documentId}`);
  }
  return {
    documentId,
    body: document.body,
    label,
    createdAt: new Date().toISOString(),
  };
}

export function restorePennyUndoSnapshot(workspace, snapshot) {
  if (!snapshot?.documentId) {
    throw new Error("Penny undo snapshot is missing.");
  }
  if (workspace.activeDocumentId !== snapshot.documentId) {
    throw new Error("Penny undo refused because the active document changed.");
  }
  return updateDocumentText(workspace, snapshot.documentId, snapshot.body || "");
}

export function applySuggestionToDocument(workspace, { documentId, suggestion, artifactContext }) {
  const document = getDocumentById(workspace, documentId);
  if (artifactContext) {
    const currentContext = buildPennyArtifactContext(workspace, document);
    if (!sameArtifactContext(artifactContext, currentContext)) {
      throw new Error("Stale Penny suggestion cannot be inserted into this draft.");
    }
  }
  const separator = document?.body?.trim() ? "\n\n" : "";
  return updateDocumentText(workspace, documentId, `${document?.body || ""}${separator}${suggestion}`);
}

function normalizeInlineNote(note) {
  const value = String(note || "").replace(/\s+/g, " ").trim();
  if (!value) {
    throw new Error("Penny inline note is empty.");
  }
  if (/^\[Penny note:.+\]$/i.test(value)) {
    return value.replace(/^\[penny note:/i, "[Penny note:");
  }
  const withoutBrackets = value.replace(/^\[/, "").replace(/\]$/, "").trim();
  return `[Penny note: ${withoutBrackets}]`;
}

export function insertInlineAnnotations(workspace, { documentId, annotations, artifactContext }) {
  const document = getDocumentById(workspace, documentId);
  if (!document) {
    throw new Error(`Unknown Penny document: ${documentId}`);
  }
  if (artifactContext) {
    const currentContext = buildPennyArtifactContext(workspace, document);
    if (!sameArtifactContext(artifactContext, currentContext)) {
      throw new Error("Stale Penny inline notes cannot be inserted into this draft.");
    }
  }
  if (!Array.isArray(annotations) || annotations.length === 0) {
    throw new Error("Penny inline notes are empty.");
  }

  const insertions = annotations.map((annotation) => {
    const anchorText = String(annotation?.anchorText || "").trim();
    const position = annotation?.position === "before" ? "before" : "after";
    if (!anchorText) {
      throw new Error("Penny inline note anchor is empty.");
    }
    const firstMatch = document.body.indexOf(anchorText);
    if (firstMatch === -1) {
      throw new Error("Penny inline note anchor is no longer present in this draft.");
    }
    const secondMatch = document.body.indexOf(anchorText, firstMatch + anchorText.length);
    if (secondMatch !== -1) {
      throw new Error("Penny inline note anchor appears more than once. Ask Penny for a more specific anchor.");
    }

    return {
      index: position === "before" ? firstMatch : firstMatch + anchorText.length,
      text: position === "before" ? `${normalizeInlineNote(annotation.note)} ` : ` ${normalizeInlineNote(annotation.note)}`,
    };
  });

  const nextBody = [...insertions]
    .sort((left, right) => right.index - left.index)
    .reduce((body, insertion) => `${body.slice(0, insertion.index)}${insertion.text}${body.slice(insertion.index)}`, document.body);

  return updateDocumentText(workspace, documentId, nextBody);
}

export function replaceDocumentTextWithSuggestion(workspace, { documentId, suggestion, artifactContext }) {
  const document = getDocumentById(workspace, documentId);
  if (!document) {
    throw new Error(`Unknown Penny document: ${documentId}`);
  }
  if (artifactContext) {
    const currentContext = buildPennyArtifactContext(workspace, document);
    if (!sameArtifactContext(artifactContext, currentContext)) {
      throw new Error("Stale Penny suggestion cannot be applied to this draft.");
    }
  }

  const selectedText = artifactContext?.selectedText || "";
  if (!selectedText) {
    return updateDocumentText(workspace, documentId, suggestion);
  }
  const selectionStart = artifactContext?.selectionStart;
  const selectionEnd = artifactContext?.selectionEnd;
  if (Number.isInteger(selectionStart) && Number.isInteger(selectionEnd)) {
    const selectedRange = document.body.slice(selectionStart, selectionEnd);
    if (selectedRange !== selectedText) {
      throw new Error("Selected range no longer matches this draft.");
    }

    return updateDocumentText(
      workspace,
      documentId,
      `${document.body.slice(0, selectionStart)}${suggestion}${document.body.slice(selectionEnd)}`,
    );
  }
  if (!document.body.includes(selectedText)) {
    throw new Error("Selected text is no longer present in this draft.");
  }
  const firstMatch = document.body.indexOf(selectedText);
  const secondMatch = document.body.indexOf(selectedText, firstMatch + selectedText.length);
  if (secondMatch !== -1) {
    throw new Error("Selected text appears more than once. Select the passage again before applying.");
  }

  return updateDocumentText(
    workspace,
    documentId,
    `${document.body.slice(0, firstMatch)}${suggestion}${document.body.slice(firstMatch + selectedText.length)}`,
  );
}

export function selectMode(workspace, modeId) {
  getPennyMode(modeId);
  return {
    ...workspace,
    selectedModeId: modeId,
  };
}

export function selectDocumentStyleProfile(workspace, documentId, styleProfileId) {
  getStyleProfile(styleProfileId);
  return mapProjects(workspace, (project) => ({
    ...project,
    documents: project.documents.map((document) =>
      document.id === documentId
        ? {
            ...document,
            styleProfileId,
            updatedAt: new Date().toISOString(),
          }
        : document,
    ),
  }));
}

function normalizeCandidate(candidate = {}) {
  return {
    id: String(candidate.id || `response-${Date.now()}`),
    content: String(candidate.content || "").trim(),
    modeId: candidate.modeId || "revise_clarity",
    styleProfileId: candidate.styleProfileId || DEFAULT_STYLE_PROFILE_ID,
    applyMode: candidate.applyMode || null,
    revisionScope: candidate.revisionScope || null,
    pinned: Boolean(candidate.pinned),
    createdAt: candidate.createdAt || new Date().toISOString(),
    context: candidate.context || null,
    sourceResponse: candidate.sourceResponse || null,
    inlineAnnotations: Array.isArray(candidate.inlineAnnotations) ? candidate.inlineAnnotations : undefined,
    responseStyleReport: candidate.responseStyleReport || undefined,
    sourceStyleReport: candidate.sourceStyleReport || undefined,
  };
}

function trimCandidates(candidates = []) {
  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate.content || seen.has(candidate.id)) continue;
    unique.push(candidate);
    seen.add(candidate.id);
  }
  if (unique.length <= MAX_PENNY_RESPONSE_CANDIDATES) return unique;
  const pinned = unique.filter((candidate) => candidate.pinned);
  const unpinned = unique.filter((candidate) => !candidate.pinned);
  return [...pinned, ...unpinned].slice(0, MAX_PENNY_RESPONSE_CANDIDATES);
}

export function addResponseCandidate(workspace, documentId, candidate) {
  const normalized = normalizeCandidate(candidate);
  if (!normalized.content) return workspace;
  return updateDocument(workspace, documentId, (document) => ({
    ...document,
    pennyResponses: trimCandidates([normalized, ...(document.pennyResponses || [])]),
  }));
}

export function pinResponseCandidate(workspace, documentId, candidateId, pinned = true) {
  return updateDocument(workspace, documentId, (document) => ({
    ...document,
    pennyResponses: (document.pennyResponses || []).map((candidate) =>
      candidate.id === candidateId ? { ...candidate, pinned: Boolean(pinned) } : candidate,
    ),
  }));
}

export function deleteResponseCandidate(workspace, documentId, candidateId) {
  return updateDocument(workspace, documentId, (document) => ({
    ...document,
    pennyResponses: (document.pennyResponses || []).filter((candidate) => candidate.id !== candidateId),
  }));
}

export function selectResponseCandidate(workspace, documentId, candidateId) {
  const document = getDocumentById(workspace, documentId);
  return document?.pennyResponses?.find((candidate) => candidate.id === candidateId) || null;
}

export function diffWords(original = "", proposed = "") {
  const left = String(original || "").trim().split(/\s+/).filter(Boolean);
  const right = String(proposed || "").trim().split(/\s+/).filter(Boolean);
  const lengths = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let row = left.length - 1; row >= 0; row -= 1) {
    for (let column = right.length - 1; column >= 0; column -= 1) {
      lengths[row][column] =
        left[row] === right[column]
          ? lengths[row + 1][column + 1] + 1
          : Math.max(lengths[row + 1][column], lengths[row][column + 1]);
    }
  }

  const parts = [];
  let row = 0;
  let column = 0;
  while (row < left.length && column < right.length) {
    if (left[row] === right[column]) {
      parts.push({ type: "equal", text: left[row] });
      row += 1;
      column += 1;
    } else if (lengths[row + 1][column] >= lengths[row][column + 1]) {
      parts.push({ type: "removed", text: left[row] });
      row += 1;
    } else {
      parts.push({ type: "added", text: right[column] });
      column += 1;
    }
  }
  while (row < left.length) {
    parts.push({ type: "removed", text: left[row] });
    row += 1;
  }
  while (column < right.length) {
    parts.push({ type: "added", text: right[column] });
    column += 1;
  }

  return parts.reduce((merged, part) => {
    const previous = merged.at(-1);
    if (previous?.type === part.type) {
      previous.text = `${previous.text} ${part.text}`;
    } else {
      merged.push({ ...part });
    }
    return merged;
  }, []);
}

export function updateDocumentPositioningContext(workspace, documentId, patch) {
  return mapProjects(workspace, (project) => ({
    ...project,
    documents: project.documents.map((document) =>
      document.id === documentId
        ? {
            ...document,
            positioningContext: normalizePositioningContext({
              ...document.positioningContext,
              ...patch,
            }),
            updatedAt: new Date().toISOString(),
          }
        : document,
    ),
  }));
}

export { normalizeWorkspace };
