import { DEFAULT_STYLE_PROFILE_ID, resolveStyleProfile } from "./domain.mjs";
import { analyzeStyleRules } from "./style_rules.mjs";
import { DEFAULT_VOICE_PACK } from "./voice_pack_schema.mjs";

const BAD_AI_OPENINGS = [
  "in today's fast-paced world",
  "in today's rapidly evolving landscape",
  "it is important to note",
  "as we navigate",
  "at the intersection of",
  "this comprehensive guide",
  "a testament to",
  "delve into",
  "unlock the power of",
  "transformative journey",
];

const GENERIC_EXECUTIVE_TERMS = [
  "alignment",
  "stakeholders",
  "innovation",
  "leverage",
  "optimize",
  "enablement",
  "strategic initiatives",
  "value creation",
  "drive outcomes",
  "impactful",
  "synergy",
];

let ANALYSIS_BY_PROFILE = new Map(
  DEFAULT_VOICE_PACK.profiles.map((profile) => [profile.id, structuredClone(DEFAULT_VOICE_PACK.analysis)]),
);

export function configureVoiceAnalysis(analysisByProfile) {
  if (!(analysisByProfile instanceof Map) || analysisByProfile.size === 0) {
    throw new Error("Penny requires voice analysis configuration for at least one profile.");
  }
  ANALYSIS_BY_PROFILE = new Map(
    [...analysisByProfile.entries()].map(([profileId, analysis]) => [profileId, structuredClone(analysis)]),
  );
}

export function resolveVoiceMode({ writingType = "", modeId = "", styleProfileId = "" } = {}) {
  if (styleProfileId) {
    return resolveStyleProfile(styleProfileId).profile.defaultVoiceMode;
  }

  const lower = `${writingType} ${modeId}`.toLowerCase();
  if (lower.includes("journal")) return "raw_journal";
  if (/\b(personal[-\s]?positioning|recruiter|executive search|cover letter|career positioning|resume|role[-\s]?fit)\b/.test(lower)) {
    return "personal_positioning";
  }
  if (lower.includes("executive") || lower.includes("memo")) return "executive";
  if (lower.includes("book") || lower.includes("chapter")) return "book_chapter";
  if (lower.includes("keynote") || lower.includes("speech")) return "keynote";
  if (lower.includes("thought")) return "thought_leadership";
  return "reflective";
}

export function analyzeVoice(text = "", options = {}) {
  const normalized = normalizeText(text);
  const resolvedProfile = resolveStyleProfile(options.styleProfileId || DEFAULT_STYLE_PROFILE_ID);
  const styleProfile = resolvedProfile.profile;
  const analysis = analysisForProfile(styleProfile.id);
  const mode = resolveVoiceMode({ ...options, styleProfileId: styleProfile.id });
  const sourceText = normalizeText(options.sourceText || "");
  const features = extractFeatures(normalized, sourceText, mode, analysis);
  const styleAnalysis = analyzeStyleRules(normalized, {
    ...options,
    mode,
    styleProfileId: styleProfile.id,
  });
  const violations = [...evaluateRules(features, mode, analysis), ...styleAnalysis.findings];
  const strengths = detectStrengths(features, mode);
  const voiceScore = scoreVoice(violations, strengths);
  const counts = countViolations(violations);
  const report = {
    ok: true,
    mode,
    styleProfile: {
      id: resolvedProfile.requestedId,
      effectiveId: styleProfile.id,
      available: resolvedProfile.available,
      label: styleProfile.label,
      outputPolicy: styleProfile.outputPolicy,
      lockedRules: styleProfile.lockedRules,
    },
    voiceScore,
    summary: {
      status: statusForReport(voiceScore, counts),
      label: labelForReport(voiceScore, counts),
    },
    calibrationNote:
      "Deterministic heuristic report. Numeric thresholds are short-draft calibration settings, not proof of authorship.",
    detectedSlots: {
      present: features.slots.present,
      missing: features.slots.missing,
    },
    strengths,
    violations,
    styleFindings: styleAnalysis,
    counts,
    features: {
      wordCount: features.wordCount,
      sentenceCount: features.sentences.length,
      questionCount: features.questionCount,
      averageSentenceWords: features.averageSentenceWords,
      sentenceLengthStdDev: features.sentenceLengthStdDev,
      vocabularyHits: features.vocabularyHits,
      stanceHits: features.stanceHits,
      preservationHits: features.preservationHits,
      sourcePreservationHits: features.sourcePreservationHits,
      aiArtifactHits: features.aiArtifactHits,
      styleArtifactHits: styleAnalysis.findings.map((finding) => finding.match),
    },
  };

  return {
    ...report,
    rewriteBrief: buildVoiceRewriteBrief(report),
    promptSummary: styleReportForPrompt(report),
  };
}

export function buildVoiceRewriteBrief(report) {
  const topIssues = report.violations.slice(0, 5);
  const missingSlots = report.detectedSlots.missing;
  const issueLines = topIssues.length
    ? topIssues.map((violation) => `- ${violation.ruleId}: ${violation.fix}`).join("\n")
    : "- Preserve the existing voice pattern and avoid unnecessary polish.";
  const missingLine = missingSlots.length ? `Missing slots: ${missingSlots.join(", ")}.` : "Required voice slots are present.";
  const lockedRules = report.styleProfile.lockedRules?.length
    ? report.styleProfile.lockedRules.map((ruleText) => `- ${ruleText}`).join("\n")
    : "- Follow the selected profile without inventing facts.";

  return [
    `Mode: ${report.mode}`,
    `Style profile: ${report.styleProfile.label}`,
    `Voice score: ${report.voiceScore} (${report.summary.label})`,
    missingLine,
    "",
    "Profile rules:",
    lockedRules,
    "",
    "Do:",
    "- Preserve lived context, visible tension, reflection, principle, and action where they exist.",
    "- Keep first-person inquiry and uncertainty when the piece is reflective.",
    "- Preserve source-specific language identified by the selected profile.",
    "- Move insight toward a practical next step, decision, or action.",
    "- Remove default AI business voice by naming the actor, action, system or workflow, before state, friction or risk, decision or ownership, and result.",
    "- Keep the right center of gravity: people, teams, customers, organizations, workflows, or decisions should carry the action when they are the real subject.",
    "- Fold short dramatic punchlines into concrete sentences unless they state a fact, decision, or boundary.",
    "",
    "Do not:",
    "- Invent biography, dates, quotes, accomplishments, names, or results.",
    "- Replace meaningful source language with generic wording unless the user asks.",
    "- Smooth the draft into generic executive prose.",
    "- Make AI, agents, abstract work, or nominalized action the protagonist when people are doing the work.",
    "- Turn positioning or audience-specific writing into a fixed formula. Adapt it to the supplied context.",
    report.styleProfile.outputPolicy === "journal_markdown"
      ? "- Over-polish fragments, questions, or task markers."
      : "- Use vague short punchlines such as This matters, The standard rises, or No shortcuts.",
    "",
    "Top issues:",
    issueLines,
  ].join("\n");
}

export function styleReportForPrompt(report) {
  const topIssues = report.violations.slice(0, 4);
  const issueText = topIssues.length
    ? topIssues.map((violation) => `${violation.ruleId}: ${violation.fix}`).join("; ")
    : "No critical voice issues detected.";
  const strengths = report.strengths.slice(0, 3).join(", ") || "none detected";
  const lockedRules = report.styleProfile.lockedRules?.slice(0, 6).join("; ") || "none";

  return [
    "Deterministic Penny style report:",
    `Mode: ${report.mode}`,
    `Style profile: ${report.styleProfile.label}`,
    `Profile rules: ${lockedRules}`,
    `Voice score: ${report.voiceScore} (${report.summary.label})`,
    `Strengths: ${strengths}`,
    `Missing slots: ${report.detectedSlots.missing.join(", ") || "none"}`,
    `Style layers: ${styleLayerSummary(report.styleFindings)}`,
    `Top issues: ${issueText}`,
    "AI-voice repair checklist: actor; action; system or workflow; before state; friction or risk; decision or ownership; result or after state.",
    "Center of Gravity check: keep the real human, team, customer, organization, workflow, or decision in subject position.",
    "No Dramatic Punctuation check: short punchlines must name the actor, action, standard, mechanism, or consequence.",
    "Use this as a rewrite brief, not as permission to invent facts.",
  ].join("\n");
}

export function applySafeMechanicalFixes(text = "", options = {}) {
  if (options.preserveMarkdown) {
    return String(text)
      .replace(/\r\n/g, "\n")
      .replace(/\$?\\rightarrow\$?/g, "->")
      .replace(/\u2192/g, "->")
      .replace(/\s*\u2014\s*/g, ", ")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
  }

  const lines = String(text)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      const heading = line.match(/^\s{0,3}#{1,6}\s*(.*)$/);
      if (heading) {
        const headingText = heading[1].trim();
        if (!headingText || containsAny(headingText, BAD_AI_OPENINGS)) return "";
        return headingText;
      }
      if (/^\s*[*_-]{3,}\s*$/.test(line)) return "";
      return line;
    });

  return lines
    .join("\n")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\$?\\rightarrow\$?/g, "->")
    .replace(/\u2192/g, "->")
    .replace(/\s*\u2014\s*/g, ", ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractFeatures(text, sourceText, mode, analysis) {
  const lower = text.toLowerCase();
  const words = lower.match(/\b[\w']+\b/g) || [];
  const sentences = splitSentences(text);
  const sentenceLengths = sentences.map((sentence) => (sentence.match(/\b[\w']+\b/g) || []).length);
  const slots = detectSlots(text, mode, analysis);

  return {
    text,
    lower,
    sourceLower: sourceText.toLowerCase(),
    wordCount: words.length,
    sentences,
    sentenceLengths,
    averageSentenceWords: average(sentenceLengths),
    sentenceLengthStdDev: standardDeviation(sentenceLengths),
    questionCount: (text.match(/\?/g) || []).length,
    slots,
    vocabularyHits: hits(lower, analysis.vocabularyMarkers),
    stanceHits: hits(lower, analysis.stanceMarkers),
    preservationHits: hits(lower, analysis.preservationMarkers),
    sourcePreservationHits: hits(sourceText.toLowerCase(), analysis.preservationMarkers),
    aiArtifactHits: hits(lower, [...BAD_AI_OPENINGS, ...GENERIC_EXECUTIVE_TERMS]),
    startsWithGenericAi: containsAny(lower.slice(0, 180), BAD_AI_OPENINGS),
    endsWithAction: (analysis.slotMarkers.action || []).some((marker) => text.slice(-280).toLowerCase().includes(marker)),
  };
}

function evaluateRules(features, mode, analysis) {
  const violations = [];
  const requiredSlots = requiredSlotsForMode(mode, analysis);
  const presentRequired = requiredSlots.filter((slot) => features.slots.present.includes(slot));
  const slotScore = requiredSlots.length ? presentRequired.length / requiredSlots.length : 1;
  const thresholds = analysis.thresholds;

  if (!["executive", "personal_positioning"].includes(mode) && slotScore < 0.67) {
    violations.push(rule("Voice.Structure.MissingJourney", "critical", "Draft is missing the selected profile's required writing journey.", "Restore the visible path from context or question to principle and action."));
  }
  if (features.startsWithGenericAi) {
    violations.push(rule("Voice.GenericOpening", "major", "Draft opens with generic AI-style abstraction.", "Open with a lived moment, concrete question, or direct practical claim."));
  }
  if (!["executive", "personal_positioning"].includes(mode) && features.stanceHits.length < thresholds.stanceMinimum) {
    violations.push(rule("Voice.Stance.Missing", "major", "Reflective draft has no visible first-person inquiry.", "Keep a real marker of inquiry, uncertainty, or point of view."));
  }
  if (features.sourcePreservationHits.length && !features.preservationHits.length) {
    violations.push(rule("Voice.Preservation.Lost", "critical", "The draft removed source language protected by the selected profile.", "Preserve the protected source language unless the user explicitly asks to translate it."));
  }
  if (!["raw_journal", "personal_positioning"].includes(mode) && !features.endsWithAction) {
    violations.push(rule("Voice.Structure.MissingAction", "major", "Draft does not land on action or implication.", "End with a practical next step, decision, or consequence."));
  }
  if (features.vocabularyHits.length < thresholds.vocabularyMinimum && !["executive", "personal_positioning"].includes(mode)) {
    violations.push(rule("Voice.Vocabulary.Thin", "minor", "Draft has weak coverage of the selected profile's vocabulary.", "Use the profile's natural vocabulary markers when they fit the source."));
  }
  if (features.aiArtifactHits.length >= 4) {
    violations.push(rule("Voice.GenericPolish", "major", "Draft leans on generic executive or AI-polish terms.", "Replace abstract terms with concrete actors, work, decisions, and consequences."));
  }
  if (
    !["executive", "personal_positioning"].includes(mode) &&
    features.sentences.length >= thresholds.cadenceSentenceMinimum &&
    features.sentenceLengthStdDev < thresholds.cadenceStdDevMinimum
  ) {
    violations.push(rule("Voice.Cadence.Uniform", "minor", "Sentence rhythm is too uniform for reflective prose.", "Mix short reflective sentences with longer explanatory ones."));
  }

  return violations;
}

function detectStrengths(features) {
  const strengths = [];
  if (features.slots.missing.length === 0) strengths.push("required writing journey");
  if (features.stanceHits.length) strengths.push("first-person inquiry");
  if (features.preservationHits.length) strengths.push("protected source language");
  if (features.vocabularyHits.length >= 4) strengths.push("profile vocabulary");
  if (features.endsWithAction) strengths.push("action landing");
  if (features.questionCount > 0) strengths.push("question cadence");
  return strengths;
}

function detectSlots(text, mode, analysis) {
  const lower = text.toLowerCase();
  const requiredSlots = requiredSlotsForMode(mode, analysis);
  const present = Object.entries(analysis.slotMarkers)
    .filter(([, markers]) => markers.some((marker) => lower.includes(marker)))
    .map(([slot]) => slot);
  const missing = requiredSlots.filter((slot) => !present.includes(slot));
  return { present, missing };
}

function requiredSlotsForMode(mode, analysis) {
  return analysis.requiredSlotsByMode[mode] || analysis.requiredSlotsByMode.reflective || [];
}

function analysisForProfile(profileId) {
  return ANALYSIS_BY_PROFILE.get(profileId) || ANALYSIS_BY_PROFILE.get(DEFAULT_STYLE_PROFILE_ID) || DEFAULT_VOICE_PACK.analysis;
}

function scoreVoice(violations, strengths) {
  const penalty = violations.reduce((total, violation) => {
    if (violation.severity === "critical") return total + 24;
    if (violation.severity === "major") return total + 13;
    return total + 5;
  }, 0);
  const bonus = Math.min(8, strengths.length * 2);
  return Math.max(0, Math.min(100, 100 - penalty + bonus));
}

function statusForReport(score, counts) {
  if (counts.critical > 0) return "needs_rewrite";
  if (counts.major >= 2) return "needs_rewrite";
  if (counts.major === 1 && score >= 80) return "revise";
  return statusForScore(score);
}

function labelForReport(score, counts) {
  if (counts.critical > 0) return "blocked by critical voice issue";
  if (counts.major >= 2) return "blocked by major voice issues";
  if (counts.major === 1 && score >= 80) return "usable but has a major issue";
  return labelForScore(score);
}

function statusForScore(score) {
  if (score >= 90) return "strong";
  if (score >= 80) return "good";
  if (score >= 70) return "revise";
  return "needs_rewrite";
}

function labelForScore(score) {
  if (score >= 90) return "strong preservation";
  if (score >= 80) return "good with minor drift";
  if (score >= 70) return "usable but diluted";
  return "major voice loss";
}

function countViolations(violations) {
  return {
    critical: violations.filter((violation) => violation.severity === "critical").length,
    major: violations.filter((violation) => violation.severity === "major").length,
    minor: violations.filter((violation) => violation.severity === "minor").length,
  };
}

function styleLayerSummary(styleFindings) {
  const counts = styleFindings?.counts;
  const byLayer = styleFindings?.byLayer || {};
  if (!counts?.total) return "none";
  return Object.entries(byLayer)
    .map(([layer, findings]) => `${layer} ${findings.length}`)
    .join("; ");
}

function rule(ruleId, severity, message, fix) {
  return { ruleId, severity, message, fix };
}

function normalizeText(text) {
  return String(text || "").replace(/\r\n/g, "\n").trim();
}

function splitSentences(text) {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function average(values) {
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const avg = average(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.round(Math.sqrt(variance) * 10) / 10;
}

function hits(text, phrases) {
  return phrases.filter((phrase) => text.includes(phrase));
}

function containsAny(text, phrases) {
  const lower = text.toLowerCase();
  return phrases.some((phrase) => lower.includes(phrase));
}
