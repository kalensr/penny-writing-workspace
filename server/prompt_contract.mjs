import {
  getPennyMode,
  resolveStyleProfile,
  listPennyModes,
} from "./domain.mjs";
import { styleReportForPrompt } from "./voice_rules.mjs";
import { formatPositioningContext, isPositioningContext } from "./style_rules.mjs";

export { getPennyMode, listPennyModes };

export function buildPennyMessages({
  modeId,
  writingType,
  documentTitle,
  draft,
  selectedText,
  instruction,
  styleProfileId,
  styleReport,
  operation,
  revisionScope,
  positioningContext,
}) {
  const mode = getPennyMode(modeId);
  const styleProfile = resolveStyleProfile(styleProfileId).profile;
  const safeSelectedText = selectedText?.trim() || "(none)";
  const safeInstruction = instruction?.trim() || "Help improve this piece.";
  const styleBrief = styleReport ? styleReportForPrompt(styleReport) : "No deterministic voice report was supplied.";
  const lockedRules = styleProfile.lockedRules.map((rule) => `- ${rule}`).join("\n");
  const positioningBlock = buildPositioningBlock({
    writingType,
    modeId,
    styleProfileId: styleProfile.id,
    positioningContext,
  });
  const allowsJournalMarkdown = styleProfile.outputPolicy === "journal_markdown";
  const outputPolicy = allowsJournalMarkdown
    ? "Preserve raw journal structure. Simple bullets, task markers, questions, and fragments are allowed when they belong to the draft. Do not add decorative Markdown."
    : "Use plain text only: no Markdown headings, no bold or italic markers, no blockquotes, no tables, and no code fences.";
  let operationLines = [];
  if (operation === "voice_revision") {
    operationLines = [
      "Operation: Voice revision",
      `Revision scope: ${revisionScope || (safeSelectedText === "(none)" ? "full_draft" : "selection")}`,
      "Return only replacement text. Do not explain, summarize, preface, or add alternatives.",
    ];
  }
  if (operation === "inline_annotations") {
    operationLines = [
      "Operation: Inline annotations",
      "Return a JSON array only. Do not include prose, Markdown, or code fences.",
      'Each item must include: "anchorText", "position", and "note".',
      'Use only "before" or "after" for position.',
      "Use exact unique draft text for anchorText. Keep anchors short enough to review but long enough to be unique.",
      "Do not rewrite, delete, or reorder existing draft text.",
      "Each note must be bracketed and start with [Penny note: ...].",
    ];
  }

  return [
    {
      role: "system",
      content: [
        "You are Penny, a local-first writing collaborator.",
        "Work like a thoughtful writing partner: practical, specific, plainspoken, and careful with the author's voice.",
        "Do not invent facts. Ask a clarifying question only when the missing context would materially change the draft.",
        "Return usable writing, critique, or options. Avoid generic AI phrasing and decorative abstraction.",
        outputPolicy,
        allowsJournalMarkdown
          ? "Do not over-polish unfinished thinking."
          : "Use simple labels, numbered lists, or hyphen lists only when structure helps the writer.",
        "Treat the deterministic voice report as a rewrite brief. It is a heuristic guide, not proof of authorship.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Mode: ${mode.label}`,
        `Mode instruction: ${mode.instruction}`,
        `Writing type: ${writingType || "unspecified"}`,
        `Document title: ${documentTitle || "Untitled"}`,
        `Style profile: ${styleProfile.label}`,
        `Locked profile rules:\n${lockedRules}`,
        `User instruction: ${safeInstruction}`,
        `Output format: ${allowsJournalMarkdown ? "raw journal structure allowed; no decorative Markdown." : "plain text only, with no Markdown syntax."}`,
        positioningBlock,
        ...operationLines,
        "",
        styleBrief,
        "",
        `Selected text:\n${safeSelectedText}`,
        "",
        `Full draft:\n${draft || ""}`,
      ].join("\n"),
    },
  ];
}

function buildPositioningBlock({ writingType, modeId, styleProfileId, positioningContext }) {
  if (!isPositioningContext({ writingType, mode: modeId, styleProfileId })) {
    return "Positioning context: not applicable.";
  }

  return [
    "Positioning context:",
    formatPositioningContext(positioningContext || {}),
    "Use this context to adapt the draft. Do not force a fixed recruiter-facing formula, role list, or before/after paragraph.",
  ].join("\n");
}
