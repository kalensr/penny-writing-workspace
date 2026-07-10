import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addResponseCandidate,
  applySuggestionToDocument,
  buildPennyArtifactContext,
  clearSelectionFocus,
  createDocument,
  createInitialWorkspace,
  createPennyUndoSnapshot,
  deleteResponseCandidate,
  diffWords,
  getArtifactFreshness,
  isPennyArtifactFresh,
  insertInlineAnnotations,
  pinResponseCandidate,
  replaceDocumentTextWithSuggestion,
  restorePennyUndoSnapshot,
  selectDocumentStyleProfile,
  selectResponseCandidate,
  setSelectionFocus,
  selectMode,
  updateDocumentPositioningContext,
  updateDocumentText,
} from "../app/src/lib/workspaceState.js";
import {
  DEFAULT_STYLE_PROFILE_ID,
  WORKSPACE_SCHEMA_VERSION,
  getStyleProfile,
  normalizeWorkspace,
} from "../server/domain.mjs";

test("Penny workspace starts with a usable project and document", () => {
  const workspace = createInitialWorkspace();

  assert.equal(workspace.activeProjectId, "project-writing-desk");
  assert.equal(workspace.activeDocumentId, "doc-quarterly-ai-adoption-memo");
  assert.equal(workspace.selectedModeId, "revise_clarity");
  assert.equal(workspace.schemaVersion, WORKSPACE_SCHEMA_VERSION);
  assert.equal(workspace.projects[0].documents[0].styleProfileId, DEFAULT_STYLE_PROFILE_ID);
  assert.deepEqual(workspace.projects[0].documents[0].positioningContext, {
    targetRoleFamily: "",
    opportunityType: "",
    audience: "",
    posture: "",
    evidenceEmphasis: "",
    boundaries: "",
  });
  assert.match(workspace.projects[0].documents[0].body, /local model/);
});

test("Penny can create and select a new document", () => {
  const workspace = createInitialWorkspace();
  const next = createDocument(workspace, {
    title: "Conference Follow-Up",
    writingType: "networking note",
  });

  assert.equal(next.activeDocumentId, "doc-conference-follow-up");
  assert.equal(next.projects[0].documents.at(-1).title, "Conference Follow-Up");
  assert.equal(next.projects[0].documents.at(-1).writingType, "networking note");
  assert.equal(next.projects[0].documents.at(-1).styleProfileId, DEFAULT_STYLE_PROFILE_ID);
  assert.equal(next.projects[0].documents.at(-1).positioningContext.audience, "");
});

test("Penny updates document text without mutating prior state", () => {
  const workspace = createInitialWorkspace();
  const next = updateDocumentText(workspace, workspace.activeDocumentId, "A sharper draft.");

  assert.notEqual(next, workspace);
  assert.match(workspace.projects[0].documents[0].body, /local model/);
  assert.equal(next.projects[0].documents[0].body, "A sharper draft.");
});

test("Penny can insert a suggestion into the active draft", () => {
  const workspace = createInitialWorkspace();
  const artifactContext = buildPennyArtifactContext(workspace);
  const next = applySuggestionToDocument(workspace, {
    documentId: workspace.activeDocumentId,
    suggestion: "This is the inserted Penny paragraph.",
    artifactContext,
  });

  assert.match(next.projects[0].documents[0].body, /This is the inserted Penny paragraph\./);
});

test("Penny can add inline annotations without changing existing draft text", () => {
  const body = "Opening claim. Bridge sentence. Closing thought.";
  const workspace = updateDocumentText(createInitialWorkspace(), "doc-quarterly-ai-adoption-memo", body);
  const artifactContext = buildPennyArtifactContext(workspace);

  const next = insertInlineAnnotations(workspace, {
    documentId: workspace.activeDocumentId,
    artifactContext,
    annotations: [
      {
        anchorText: "Opening claim.",
        position: "after",
        note: "[Penny note: Add the lived moment that proves why this matters.]",
      },
      {
        anchorText: "Closing thought.",
        position: "before",
        note: "Make this landing more concrete.",
      },
    ],
  });

  assert.equal(
    getActiveBody(next),
    "Opening claim. [Penny note: Add the lived moment that proves why this matters.] Bridge sentence. [Penny note: Make this landing more concrete.] Closing thought.",
  );
  assert.match(getActiveBody(next), /Opening claim\./);
  assert.match(getActiveBody(next), /Bridge sentence\./);
  assert.match(getActiveBody(next), /Closing thought\./);
});

test("Penny refuses inline annotations when the draft context is stale", () => {
  const workspace = updateDocumentText(
    createInitialWorkspace(),
    "doc-quarterly-ai-adoption-memo",
    "Opening claim. Bridge sentence.",
  );
  const artifactContext = buildPennyArtifactContext(workspace);
  const edited = updateDocumentText(workspace, workspace.activeDocumentId, "Opening claim changed. Bridge sentence.");

  assert.throws(
    () =>
      insertInlineAnnotations(edited, {
        documentId: edited.activeDocumentId,
        artifactContext,
        annotations: [{ anchorText: "Opening claim.", position: "after", note: "[Penny note: Add detail.]" }],
      }),
    /Stale Penny inline notes/,
  );
});

test("Penny refuses inline annotations when an anchor is missing or repeated", () => {
  const workspace = updateDocumentText(
    createInitialWorkspace(),
    "doc-quarterly-ai-adoption-memo",
    "Repeat this line. Middle. Repeat this line.",
  );
  const artifactContext = buildPennyArtifactContext(workspace);

  assert.throws(
    () =>
      insertInlineAnnotations(workspace, {
        documentId: workspace.activeDocumentId,
        artifactContext,
        annotations: [{ anchorText: "Missing line.", position: "after", note: "[Penny note: Add detail.]" }],
      }),
    /anchor is no longer present/,
  );
  assert.throws(
    () =>
      insertInlineAnnotations(workspace, {
        documentId: workspace.activeDocumentId,
        artifactContext,
        annotations: [{ anchorText: "Repeat this line.", position: "after", note: "[Penny note: Add detail.]" }],
      }),
    /anchor appears more than once/,
  );
});

test("Penny refuses stale suggestions after document or draft context changes", () => {
  const workspace = createInitialWorkspace();
  const artifact = { context: buildPennyArtifactContext(workspace), content: "Old suggestion." };
  const withSecondDocument = createDocument(workspace, {
    title: "Second Draft",
    writingType: "draft",
  });

  assert.equal(isPennyArtifactFresh(artifact, workspace), true);
  assert.equal(isPennyArtifactFresh(artifact, withSecondDocument), false);
  assert.throws(
    () =>
      applySuggestionToDocument(withSecondDocument, {
        documentId: withSecondDocument.activeDocumentId,
        suggestion: artifact.content,
        artifactContext: artifact.context,
      }),
    /Stale Penny suggestion/,
  );

  const edited = updateDocumentText(workspace, workspace.activeDocumentId, `${getActiveBody(workspace)}\n\nA new line.`);
  assert.equal(isPennyArtifactFresh(artifact, edited), false);
});

test("Penny can replace the selected passage with a voice revision", () => {
  const workspace = updateDocumentText(
    createInitialWorkspace(),
    "doc-quarterly-ai-adoption-memo",
    "Opening sentence. This middle needs voice. Closing sentence.",
  );
  const selectedText = "This middle needs voice.";
  const focused = { ...workspace, selectedText };
  const artifactContext = buildPennyArtifactContext(focused);

  const next = replaceDocumentTextWithSuggestion(focused, {
    documentId: focused.activeDocumentId,
    suggestion: "This middle has a clearer voice.",
    artifactContext,
  });

  assert.equal(
    getActiveBody(next),
    "Opening sentence. This middle has a clearer voice. Closing sentence.",
  );
});

test("Penny replaces the exact selected range when repeated text exists", () => {
  const body = "Repeat this line. Keep the bridge. Repeat this line.";
  const workspace = updateDocumentText(
    createInitialWorkspace(),
    "doc-quarterly-ai-adoption-memo",
    body,
  );
  const secondStart = body.lastIndexOf("Repeat this line.");
  const selectedText = "Repeat this line.";
  const focused = {
    ...workspace,
    selectedText,
    selectionStart: secondStart,
    selectionEnd: secondStart + selectedText.length,
  };
  const artifactContext = buildPennyArtifactContext(focused);

  const next = replaceDocumentTextWithSuggestion(focused, {
    documentId: focused.activeDocumentId,
    suggestion: "The second repeated line now carries the point.",
    artifactContext,
  });

  assert.equal(
    getActiveBody(next),
    "Repeat this line. Keep the bridge. The second repeated line now carries the point.",
  );
});

test("Penny can apply a focused selected range after the browser DOM selection clears", () => {
  const body = "Opening sentence. This middle needs voice. Closing sentence.";
  const workspace = updateDocumentText(createInitialWorkspace(), "doc-quarterly-ai-adoption-memo", body);
  const selectedText = "This middle needs voice.";
  const start = body.indexOf(selectedText);
  const focused = {
    ...workspace,
    selectedText,
    selectionStart: start,
    selectionEnd: start + selectedText.length,
  };
  const artifactContext = buildPennyArtifactContext(focused);
  assert.equal(isPennyArtifactFresh({ context: artifactContext }, focused), true);

  const next = replaceDocumentTextWithSuggestion(focused, {
    documentId: focused.activeDocumentId,
    suggestion: "This middle has a clearer voice.",
    artifactContext,
  });

  assert.equal(
    getActiveBody(next),
    "Opening sentence. This middle has a clearer voice. Closing sentence.",
  );
});

test("Penny can replace the full draft when no passage is selected", () => {
  const workspace = updateDocumentText(
    createInitialWorkspace(),
    "doc-quarterly-ai-adoption-memo",
    "Original full draft.",
  );
  const artifactContext = buildPennyArtifactContext(workspace);

  const next = replaceDocumentTextWithSuggestion(workspace, {
    documentId: workspace.activeDocumentId,
    suggestion: "Revised full draft.",
    artifactContext,
  });

  assert.equal(getActiveBody(next), "Revised full draft.");
});

test("Penny refuses replacement when selected text no longer exists", () => {
  const workspace = updateDocumentText(
    createInitialWorkspace(),
    "doc-quarterly-ai-adoption-memo",
    "Opening sentence. This middle needs voice. Closing sentence.",
  );
  const focused = { ...workspace, selectedText: "This middle needs voice." };
  const artifactContext = buildPennyArtifactContext(focused);
  const edited = updateDocumentText(
    focused,
    focused.activeDocumentId,
    "Opening sentence. The middle changed manually. Closing sentence.",
  );

  assert.throws(
    () =>
      replaceDocumentTextWithSuggestion(edited, {
        documentId: edited.activeDocumentId,
        suggestion: "This middle has a clearer voice.",
        artifactContext: { ...artifactContext, draftFingerprint: buildPennyArtifactContext(edited).draftFingerprint },
      }),
    /Selected text is no longer present/,
  );
});

test("Penny refuses replacement when the selected range no longer matches", () => {
  const body = "Repeat this line. Keep the bridge. Repeat this line.";
  const workspace = updateDocumentText(createInitialWorkspace(), "doc-quarterly-ai-adoption-memo", body);
  const selectedText = "Repeat this line.";
  const focused = {
    ...workspace,
    selectedText,
    selectionStart: body.lastIndexOf(selectedText),
    selectionEnd: body.length,
  };
  const artifactContext = buildPennyArtifactContext(focused);
  const edited = updateDocumentText(
    focused,
    focused.activeDocumentId,
    "Repeat this line. Keep the bridge. The second sentence changed.",
  );

  assert.throws(
    () =>
      replaceDocumentTextWithSuggestion(edited, {
        documentId: edited.activeDocumentId,
        suggestion: "Replacement.",
        artifactContext: { ...artifactContext, draftFingerprint: buildPennyArtifactContext(edited).draftFingerprint },
      }),
    /Selected range no longer matches/,
  );
});

test("Penny refuses selected-text fallback when the text appears more than once", () => {
  const body = "Repeat this line. Keep the bridge. Repeat this line.";
  const workspace = updateDocumentText(createInitialWorkspace(), "doc-quarterly-ai-adoption-memo", body);
  const focused = {
    ...workspace,
    selectedText: "Repeat this line.",
    selectionStart: null,
    selectionEnd: null,
  };
  const artifactContext = buildPennyArtifactContext(focused);

  assert.throws(
    () =>
      replaceDocumentTextWithSuggestion(focused, {
        documentId: focused.activeDocumentId,
        suggestion: "Replacement.",
        artifactContext,
      }),
    /appears more than once/,
  );
});

test("Penny mode selection is explicit and validated", () => {
  const workspace = createInitialWorkspace();
  const next = selectMode(workspace, "quality_review");

  assert.equal(next.selectedModeId, "quality_review");
  assert.throws(() => selectMode(workspace, "unknown"), /Unknown Penny mode/);
});

test("Penny document style profile selection is explicit and validated", () => {
  const workspace = createInitialWorkspace();
  const next = selectDocumentStyleProfile(workspace, workspace.activeDocumentId, "executive");

  assert.equal(next.projects[0].documents[0].styleProfileId, "executive");
  assert.equal(getStyleProfile("executive").label, "Executive");
  assert.throws(
    () => selectDocumentStyleProfile(workspace, workspace.activeDocumentId, "unknown-profile"),
    /Unknown Penny style profile/,
  );
});

test("Penny stores positioning context per document and uses it for artifact freshness", () => {
  const workspace = createInitialWorkspace();
  const positioned = updateDocumentPositioningContext(workspace, workspace.activeDocumentId, {
    targetRoleFamily: "technology executive",
    opportunityType: "platform modernization",
    audience: "retained search partner",
  });
  const artifactContext = buildPennyArtifactContext(positioned);
  const changed = updateDocumentPositioningContext(positioned, positioned.activeDocumentId, {
    audience: "hiring CEO",
  });

  assert.equal(positioned.projects[0].documents[0].positioningContext.targetRoleFamily, "technology executive");
  assert.equal(positioned.projects[0].documents[0].positioningContext.audience, "retained search partner");
  assert.equal(isPennyArtifactFresh({ context: artifactContext }, positioned), true);
  assert.equal(isPennyArtifactFresh({ context: artifactContext }, changed), false);
});

test("Penny normalizes older workspace files without losing draft content", () => {
  const oldWorkspace = {
    activeProjectId: "project-writing-desk",
    activeDocumentId: "doc-old",
    selectedModeId: "revise_clarity",
    projects: [
      {
        id: "project-writing-desk",
        name: "Writing desk",
        documents: [
          {
            id: "doc-old",
            title: "Old Draft",
            writingType: "leadership reflection",
            body: "A saved draft from before style profiles.",
            styleProfileId: "stale-profile",
            positioningContext: {
              targetRoleFamily: " CTO ",
              unknown: "ignored",
            },
          },
        ],
      },
    ],
  };

  const normalized = normalizeWorkspace(oldWorkspace);

  assert.equal(normalized.schemaVersion, WORKSPACE_SCHEMA_VERSION);
  assert.equal(normalized.projects[0].documents[0].body, "A saved draft from before style profiles.");
  assert.equal(normalized.projects[0].documents[0].styleProfileId, "stale-profile");
  assert.equal(normalized.projects[0].documents[0].positioningContext.targetRoleFamily, "CTO");
  assert.equal(normalized.projects[0].documents[0].positioningContext.opportunityType, "");
});

test("Penny does not restore stale browser selection from persisted workspace files", () => {
  const normalized = normalizeWorkspace({
    activeProjectId: "project-writing-desk",
    activeDocumentId: "doc-1",
    selectedModeId: "revise_clarity",
    selectedText: "Repeat this line.",
    selectionStart: 12,
    selectionEnd: 29,
    projects: [
      {
        id: "project-writing-desk",
        name: "Writing desk",
        documents: [
          {
            id: "doc-1",
            title: "Repeated Draft",
            body: "Repeat this line. Keep the bridge. Repeat this line.",
          },
        ],
      },
    ],
  });

  assert.equal(normalized.selectedText, "");
  assert.equal(normalized.selectionStart, null);
  assert.equal(normalized.selectionEnd, null);
});

test("Penny selection focus can be set and explicitly cleared", () => {
  const workspace = createInitialWorkspace();
  const focused = setSelectionFocus(workspace, {
    text: "local model",
    start: 15,
    end: 26,
  });

  assert.equal(focused.selectedText, "local model");
  assert.equal(focused.selectionStart, 15);
  assert.equal(focused.selectionEnd, 26);

  const cleared = clearSelectionFocus(focused);
  assert.equal(cleared.selectedText, "");
  assert.equal(cleared.selectionStart, null);
  assert.equal(cleared.selectionEnd, null);
});

test("Penny artifact freshness reports selection and instruction drift", () => {
  const workspace = setSelectionFocus(createInitialWorkspace(), {
    text: "local model",
    start: 36,
    end: 47,
  });
  const artifact = { context: buildPennyArtifactContext(workspace), content: "Suggestion." };

  assert.equal(isPennyArtifactFresh(artifact, workspace), true);

  const changedSelection = setSelectionFocus(workspace, {
    text: "writing workflow",
    start: 128,
    end: 144,
  });
  const selectionFreshness = getArtifactFreshness(artifact, changedSelection);
  assert.equal(selectionFreshness.fresh, false);
  assert.ok(selectionFreshness.reasons.includes("selection"));

  const changedInstruction = { ...workspace, instruction: "Make this rougher." };
  const instructionFreshness = getArtifactFreshness(artifact, changedInstruction);
  assert.equal(instructionFreshness.fresh, false);
  assert.ok(instructionFreshness.reasons.includes("instruction"));
});

test("Penny undo snapshot restores only the matching active document", () => {
  const workspace = updateDocumentText(createInitialWorkspace(), "doc-quarterly-ai-adoption-memo", "Original body.");
  const snapshot = createPennyUndoSnapshot(workspace, workspace.activeDocumentId, "voice revision");
  const edited = updateDocumentText(workspace, workspace.activeDocumentId, "Changed by Penny.");

  const restored = restorePennyUndoSnapshot(edited, snapshot);
  assert.equal(getActiveBody(restored), "Original body.");

  const otherDocument = createDocument(edited, { title: "Other Draft", writingType: "draft" });
  assert.throws(() => restorePennyUndoSnapshot(otherDocument, snapshot), /active document changed/);
});

test("Penny response candidates are capped, pinned, selectable, and deletable", () => {
  let workspace = createInitialWorkspace();
  for (let index = 1; index <= 9; index += 1) {
    workspace = addResponseCandidate(workspace, workspace.activeDocumentId, {
      id: `candidate-${index}`,
      content: `Candidate ${index}`,
      modeId: "revise_clarity",
      styleProfileId: "reflective",
    });
  }

  let document = workspace.projects[0].documents[0];
  assert.equal(document.pennyResponses.length, 8);
  assert.equal(document.pennyResponses[0].content, "Candidate 9");
  assert.equal(document.pennyResponses.at(-1).content, "Candidate 2");

  workspace = pinResponseCandidate(workspace, workspace.activeDocumentId, "candidate-2", true);
  workspace = addResponseCandidate(workspace, workspace.activeDocumentId, {
    id: "candidate-10",
    content: "Candidate 10",
    modeId: "revise_clarity",
    styleProfileId: "reflective",
  });
  document = workspace.projects[0].documents[0];
  assert.ok(document.pennyResponses.some((candidate) => candidate.id === "candidate-2" && candidate.pinned));
  assert.equal(document.pennyResponses.length, 8);

  const selected = selectResponseCandidate(workspace, workspace.activeDocumentId, "candidate-2");
  assert.equal(selected.content, "Candidate 2");

  workspace = deleteResponseCandidate(workspace, workspace.activeDocumentId, "candidate-2");
  assert.equal(workspace.projects[0].documents[0].pennyResponses.some((candidate) => candidate.id === "candidate-2"), false);
});

test("Penny workspace normalization preserves pinned response candidates when capping", () => {
  const workspace = createInitialWorkspace();
  const responses = Array.from({ length: 10 }, (_, index) => ({
    id: `saved-${index + 1}`,
    content: `Saved response ${index + 1}`,
    modeId: "revise_clarity",
    styleProfileId: "reflective",
    pinned: index === 0,
  }));
  const rawWorkspace = {
    ...workspace,
    projects: [
      {
        ...workspace.projects[0],
        documents: [
          {
            ...workspace.projects[0].documents[0],
            pennyResponses: responses,
          },
        ],
      },
    ],
  };

  const normalized = normalizeWorkspace(rawWorkspace);
  const normalizedResponses = normalized.projects[0].documents[0].pennyResponses;
  assert.equal(normalizedResponses.length, 8);
  assert.ok(normalizedResponses.some((candidate) => candidate.id === "saved-1" && candidate.pinned));
});

test("Penny word diff marks added and removed text without dependencies", () => {
  const diff = diffWords("The draft is useful but flat.", "The draft is useful and concrete.");

  assert.deepEqual(diff, [
    { type: "equal", text: "The draft is useful" },
    { type: "removed", text: "but flat." },
    { type: "added", text: "and concrete." },
  ]);
});

function getActiveBody(workspace) {
  return workspace.projects[0].documents.find((document) => document.id === workspace.activeDocumentId).body;
}
