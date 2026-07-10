import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeVoice,
  applySafeMechanicalFixes,
  buildVoiceRewriteBrief,
  styleReportForPrompt,
} from "../server/voice_rules.mjs";

test("generic reflective profile recognizes a grounded writing journey", () => {
  const report = analyzeVoice(
    "I remember when the team faced pressure. I wonder which decision will serve the customer. I think the principle is clear. My next step is to decide with the team.",
    { styleProfileId: "reflective" },
  );
  assert.equal(report.mode, "reflective");
  assert.equal(report.styleProfile.id, "reflective");
  assert.ok(report.detectedSlots.present.includes("lived_moment"));
  assert.ok(report.detectedSlots.present.includes("action"));
  assert.equal(report.violations.some((item) => item.ruleId === "Voice.Structure.MissingJourney"), false);
});

test("generic engine flags abstract openings and missing structure", () => {
  const report = analyzeVoice("In today's rapidly evolving landscape, leaders must leverage alignment.", {
    styleProfileId: "reflective",
  });
  const ids = report.violations.map((item) => item.ruleId);
  assert.ok(ids.includes("Voice.GenericOpening"));
  assert.ok(ids.includes("Voice.Structure.MissingJourney"));
  assert.equal(report.summary.status, "needs_rewrite");
});

test("explicit profiles govern mode and output policy", () => {
  const executive = analyzeVoice("Recommendation: keep the pilot local. The next step is review.", {
    styleProfileId: "executive",
  });
  const journal = analyzeVoice("- [ ] Review the decision\n- What is the real question?", {
    styleProfileId: "raw-journal",
  });
  assert.equal(executive.mode, "executive");
  assert.equal(executive.styleProfile.outputPolicy, "plain_text");
  assert.equal(journal.mode, "raw_journal");
  assert.equal(journal.styleProfile.outputPolicy, "journal_markdown");
});

test("unknown saved profiles remain visible while analysis uses the default", () => {
  const report = analyzeVoice("I think the next step is review.", { styleProfileId: "private-pack-missing" });
  assert.equal(report.styleProfile.id, "private-pack-missing");
  assert.equal(report.styleProfile.effectiveId, "reflective");
  assert.equal(report.styleProfile.available, false);
});

test("rewrite and prompt summaries expose generic deterministic findings", () => {
  const report = analyzeVoice("Leadership is important because it enables value creation.", {
    styleProfileId: "reflective",
  });
  assert.match(buildVoiceRewriteBrief(report), /Mode: reflective/);
  assert.match(buildVoiceRewriteBrief(report), /VoiceProfile\.AbstractOpening/);
  assert.match(styleReportForPrompt(report), /AI-voice repair checklist/);
  assert.doesNotMatch(styleReportForPrompt(report), /private-name-marker|private-belief-marker/i);
});

test("positioning context is contextual and missing fields are advisory", () => {
  const complete = analyzeVoice("The team reduced review delays by assigning one decision owner.", {
    styleProfileId: "executive",
    writingType: "career positioning",
    positioningContext: {
      targetRoleFamily: "technology leadership",
      opportunityType: "direct outreach",
      audience: "search partner",
      posture: "exploratory",
      evidenceEmphasis: "operating systems",
      boundaries: "no unsupported claims",
    },
  });
  const incomplete = analyzeVoice("I am exploring technology leadership opportunities.", {
    styleProfileId: "executive",
    writingType: "career positioning",
    positioningContext: {},
  });
  assert.equal(complete.styleFindings.byLayer.PositioningContext, undefined);
  assert.equal(incomplete.styleFindings.byLayer.PositioningContext.length, 1);
  assert.equal(incomplete.styleFindings.byLayer.PositioningContext[0].severity, "minor");
});

test("center-of-gravity and dramatic-punctuation checks stay generic", () => {
  const report = analyzeVoice("AI is changing review workflows. This matters.", { styleProfileId: "executive" });
  assert.ok(report.styleFindings.byLayer.CenterOfGravity.length >= 1);
  assert.ok(report.styleFindings.byLayer.DramaticPunctuation.length >= 1);
  assert.ok(report.styleFindings.findings.every((finding) => Number.isInteger(finding.index)));
});

test("safe mechanical fixes preserve meaning and optionally journal markers", () => {
  assert.equal(applySafeMechanicalFixes("## Decision\n**Keep it local** — review next."), "Decision\nKeep it local, review next.");
  assert.equal(
    applySafeMechanicalFixes("- [ ] Review\n- A question?", { preserveMarkdown: true }),
    "- [ ] Review\n- A question?",
  );
});
