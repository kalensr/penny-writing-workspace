const HOUSE_STYLE_RULES = [
  {
    ruleId: "HST-ACRONYM-001",
    severity: "minor",
    pattern: /\b(?!AI\b|API\b|URL\b|PDF\b|HTML\b|CSS\b|JSON\b|YAML\b|README\b|MIT\b)[A-Z]{2,6}s?\b/g,
    message: "Possible acronym should be defined on first use.",
    fix: "Confirm the acronym is defined or replace it with plain language.",
  },
  {
    ruleId: "HST-CONTRAST-001",
    severity: "minor",
    pattern: /\b(?:this|it|that|ai assistance|automation|the system)\s+(?:is|does)\s+not\b[^.]{0,160}\.\s+(?:it\s+is|it's|the\s+(?:failure|point|answer|standard|skill)\s+is)\b/gi,
    message: "This reads like a contrast formula.",
    fix: "State the point directly with ownership language or a specific standard.",
  },
  {
    ruleId: "HST-CONTRAST-002",
    severity: "minor",
    pattern: /\bnot\s+(?:just|only)\b[^.]{0,160}\bbut\b/gi,
    message: "This reads like a contrast formula.",
    fix: "State the positive claim directly instead of using not-just or not-only scaffolding.",
  },
  {
    ruleId: "HST-FILLER-001",
    severity: "minor",
    pattern: /\b(?:it is important to note|it should be noted|needless to say|in conclusion|in summary|at the end of the day|moving forward|as we navigate)\b/gi,
    message: "This phrase is likely filler.",
    fix: "Remove the filler phrase unless it is necessary for meaning.",
  },
  {
    ruleId: "HST-JARGON-001",
    severity: "minor",
    pattern: /\b(?:leverage|utilize|best-in-class|world-class|seamless|robust|synergy|operationalize|unlock value|move the needle|drive alignment|low-hanging fruit|north star)\b/gi,
    message: "This phrase may read as jargon.",
    fix: "Prefer a simpler word or name the actual action and result.",
  },
  {
    ruleId: "HST-DASH-001",
    severity: "minor",
    pattern: /\u2014/g,
    message: "Draft uses a Unicode em dash.",
    fix: "Use a comma, colon, or sentence break instead of an em dash.",
  },
  {
    ruleId: "HST-STOCK-001",
    severity: "minor",
    pattern: /\b(?:serves as a testament|stands as a testament|paving the way|the future is bright|only time will tell|beacon of hope)\b/gi,
    message: "This sounds like a stock conclusion.",
    fix: "State the decision, implication, or next step directly.",
  },
  {
    ruleId: "HST-WEAK-001",
    severity: "minor",
    pattern: /\b(?:very|really|clearly|significantly|various|quite)\b/gi,
    message: "This modifier can weaken clarity.",
    fix: "Be more specific or remove the modifier.",
  },
];

const AI_VOICE_RULES = [
  {
    ruleId: "AIV-ABSTRACT-NEED-001",
    severity: "minor",
    pattern: /\bwhere\s+[^.]{1,80}\bneed(?:s)?\s+stronger\s+ownership\b/gi,
    message: "This sounds like an abstract business-need clause.",
    fix: "Name the system, owner, decision, or operating symptom.",
  },
  {
    ruleId: "AIV-ABSTRACT-NEED-002",
    severity: "minor",
    pattern: /\bwhere\s+[^.]{1,80}\bneed(?:s)?\s+stronger\s+ownership\b/gi,
    message: "This sounds like an abstract business-need clause.",
    fix: "If using ownership, name what is owned and what changes.",
  },
  {
    ruleId: "AIV-ROLE-FIT-001",
    severity: "minor",
    pattern: /\b(?:roles?|positions?|opportunities)\s+that\s+(?:fit|suit|match)\s+(?:me|my\s+background)\b/gi,
    message: "This sounds like generated role-fit framing.",
    fix: "State the current target role family directly, based on the opportunity.",
  },
  {
    ruleId: "AIV-PATTERN-001",
    severity: "minor",
    pattern: /^\s*The\s+pattern\s+[^.]{1,120}\bis\s+familiar\b/gim,
    message: "This announces a pattern before showing the situation.",
    fix: "Start with the concrete pressure, decision, or before state.",
  },
  {
    ruleId: "AIV-PATTERN-002",
    severity: "minor",
    pattern: /^\s*The\s+pattern\s+[^.]{1,120}\bis\s+familiar\b/gim,
    message: "This announces a pattern before showing the situation.",
    fix: "Show the situation first and let the pattern emerge from evidence.",
  },
  {
    ruleId: "AIV-BEFORE-STATE-001",
    severity: "minor",
    pattern:
      /\b(?:technology|the\s+organization|the\s+team|the\s+systems?|the\s+environment|the\s+culture|the\s+business|the\s+function|engineering|operations)\s+(?:was|were|is|are|had\s+become|became)\s+(?:\w+ly\s+)?[a-z]+,\s+[a-z]+,\s+and\s+[^.]{2,60}/gi,
    message: "This before-state label sounds flattened.",
    fix: "Prefer specific facts about the system, vendor model, incident, or support condition.",
  },
  {
    ruleId: "AIV-CONSEQUENCE-001",
    severity: "minor",
    pattern:
      /\b(?:(?:created|creating|caused|causing|introduced|introducing|added|adding|drove|driving|led\s+to|resulted\s+in)\s+(?:\w+\s+){0,3}?(?:strain|friction)|(?:operating|operational)\s+(?:strain|friction)|(?:created|creating|introduced|introducing|added|adding)\s+(?:unnecessary\s+|significant\s+|extra\s+)?complexity)\b/gi,
    message: "This names a problem without the visible symptom.",
    fix: "Say what happened, which workflow was affected, and who felt it.",
  },
  {
    ruleId: "AIV-ABSTRACTION-001",
    severity: "minor",
    pattern:
      /\b(?:visibility|alignment|ownership|priorities|execution|strategy|accountability|leadership|governance|delivery)\b[^.]{0,80}?\b(?:move|moves|moving|moved|come|comes|coming)\s+together\b/gi,
    message: "This coordinates abstract categories.",
    fix: "Say what someone sees, decides, changes, or owns.",
  },
  {
    ruleId: "AIV-WORK-NOUN-001",
    severity: "minor",
    pattern:
      /\b(?:the\s+work\s+is\s+not\s+(?:only|just|merely|simply)\s+\w+ing|the\s+work\s+is\s+not\s+about|the\s+real\s+work\s+is\s+not)\b/gi,
    message: "This uses an empty work noun and contrast scaffold.",
    fix: "Name the actual task, decision, system, or operating change.",
  },
];

const PROFILE_STYLE_RULES = [
  {
    ruleId: "VoiceProfile.AbstractOpening",
    severity: "minor",
    pattern: /^\s*(?:Leadership|Transformation|Strategy|Technology|Innovation)\s+is\s+important\s+because\b/gim,
    message: "This opens with abstraction.",
    fix: "Open with a concrete moment, pressure, question, or decision.",
  },
  {
    ruleId: "VoiceProfile.GroupEvidence",
    severity: "minor",
    pattern: /\b(?:teams|communities|businesses|leaders|organizations)\s+need\s+(?:better|stronger|more|greater|bold)\s+(?:leadership|examples|alignment|clarity|vision)\b/gi,
    message: "This group claim may need support.",
    fix: "Add evidence, an example, a lived observation, or mark it as an assumption.",
  },
  {
    ruleId: "VoiceProfile.GenericPolish",
    severity: "major",
    pattern: /\b(?:strategic initiatives|drive alignment|unlock value|drive outcomes|value creation|empower stakeholders|innovative transformation|transformative outcomes)\b/gi,
    message: "This sounds like generic executive polish.",
    fix: "Replace it with the concrete subject, action, and consequence.",
  },
];

const CENTER_OF_GRAVITY_RULES = [
  {
    ruleId: "CenterOfGravity.ToolProtagonist",
    severity: "minor",
    pattern:
      /(?:^|[.!?]\s+)\s*(?:AI|Artificial\s+intelligence|Agents?|The\s+agent|The\s+agents|Automation)\s+(?:is|are|will|can|could|should|needs?|helps?|changes?|drives?|creates?|defines?|raises?|becomes?|makes?|turns?|moves?|shapes?|transforms?)\b/gi,
    message: "This makes AI or agents the protagonist.",
    fix: "Name the person, team, customer, or organization doing the work.",
  },
  {
    ruleId: "CenterOfGravity.EmptyWorkSubject",
    severity: "minor",
    pattern:
      /(?:^|[.!?]\s+)\s*(?:The\s+work|This\s+work|The\s+pattern|The\s+system|This|It)\s+(?:is|are|was|were|becomes?|means?|requires?|needs?|helps?|changes?|creates?|drives?|raises?)\b[^.]{0,90}\b(?:AI|agents?|planning|review|delivery|ownership|accountability|architecture|decisions?|workflows?)\b/gi,
    message: "This uses a vague subject for human work.",
    fix: "Name who is adapting, deciding, reviewing, or owning the change.",
  },
  {
    ruleId: "CenterOfGravity.NominalizedHumanAction",
    severity: "minor",
    pattern:
      /(?:^|[.!?]\s+)\s*(?:Adoption|Adaptation|Implementation|Alignment|Modernization|Transformation|Evaluation|Review|Ownership|Governance|Execution|Strategy|Visibility)\s+(?:requires?|needs?|creates?|drives?|enables?|improves?|changes?|turns?|becomes?|makes?|helps?)\b/gi,
    message: "This makes a nominalized action the subject.",
    fix: "Turn it back into people doing, deciding, reviewing, or owning something.",
  },
];

const DRAMATIC_PUNCTUATION_RULES = [
  {
    ruleId: "DramaticPunctuation.VaguePunchline",
    severity: "minor",
    pattern:
      /(?:^|[.!?]\s+)\s*(?:This|That|It)\s+(?:matters|changed?\s+everything|is\s+the\s+point|is\s+the\s+shift|is\s+where\s+the\s+work\s+changes|raises?\s+the\s+standard)\s*\./gi,
    message: "This short line uses a vague pronoun for drama.",
    fix: "Fold it into a concrete sentence with actor, action, standard, mechanism, or consequence.",
  },
  {
    ruleId: "DramaticPunctuation.AbstractPunchline",
    severity: "minor",
    pattern:
      /(?:^|[.!?]\s+)\s*(?:The\s+(?:work|pattern|standard|shift|moment|future|bar)|This\s+(?:work|pattern|shift|moment))\s+(?:matters|changes?\s+everything|changes?|rises|is\s+clear|is\s+different)\s*\./gi,
    message: "This makes an abstract subject carry a dramatic punchline.",
    fix: "Name who does what and why it matters.",
  },
  {
    ruleId: "DramaticPunctuation.FragmentEmphasis",
    severity: "minor",
    pattern:
      /(?:^|[.!?]\s+)\s*(?:No\s+shortcuts|Full\s+stop|The\s+point|The\s+shift|The\s+work)\s*\./gi,
    message: "This fragment is acting as dramatic punctuation.",
    fix: "Keep it only for a concrete fact or fold it into the sentence it depends on.",
  },
];

const SENTENCE_COMPLEXITY_MAX_COMMAS = 3;

export function analyzeStyleRules(text = "", options = {}) {
  const source = String(text || "");
  const findings = [
    ...matchRules(source, HOUSE_STYLE_RULES, "HouseStyle"),
    ...matchRules(source, PROFILE_STYLE_RULES, "VoiceProfile"),
    ...matchRules(source, AI_VOICE_RULES, "AIVoice"),
    ...matchRules(source, CENTER_OF_GRAVITY_RULES, "CenterOfGravity"),
    ...dramaticPunctuationFindings(source, options),
    ...sentenceComplexityFindings(source),
    ...positioningContextFindings(source, options),
  ];

  return {
    findings,
    byLayer: groupByLayer(findings),
    counts: countFindings(findings),
    repairChecklist: [
      "actor",
      "action",
      "system or workflow",
      "before state",
      "friction or risk",
      "decision or ownership",
      "result or after state",
      "center of gravity",
      "concrete sentence rhythm",
    ],
  };
}

export function isPositioningContext({ writingType = "", mode = "", styleProfileId = "" } = {}) {
  const lower = `${writingType} ${mode} ${styleProfileId}`.toLowerCase();
  return /\b(personal[-\s]?positioning|recruiter|executive search|cover letter|career positioning|resume|role[-\s]?fit)\b/.test(
    lower,
  );
}

export function formatPositioningContext(positioningContext = {}) {
  const entries = [
    ["Target role family", positioningContext.targetRoleFamily],
    ["Opportunity type", positioningContext.opportunityType],
    ["Audience", positioningContext.audience],
    ["Posture", positioningContext.posture],
    ["Evidence emphasis", positioningContext.evidenceEmphasis],
    ["Boundaries", positioningContext.boundaries],
  ];

  return entries.map(([label, value]) => `${label}: ${formatContextValue(value)}`).join("\n");
}

function matchRules(text, rules, layer) {
  return rules.flatMap((definition) => {
    const pattern = clonePattern(definition.pattern);
    const matches = [];
    for (const match of text.matchAll(pattern)) {
      matches.push({
        layer,
        ruleId: definition.ruleId,
        severity: definition.severity,
        message: definition.message,
        fix: definition.fix,
        match: match[0],
        index: match.index ?? 0,
        endIndex: (match.index ?? 0) + match[0].length,
      });
    }
    return matches;
  });
}

function sentenceComplexityFindings(text) {
  return splitSentences(text).flatMap((sentence) => {
    const commaCount = (sentence.match(/,/g) || []).length;
    if (commaCount <= SENTENCE_COMPLEXITY_MAX_COMMAS) return [];
    return [
      {
        layer: "HouseStyle",
        ruleId: "HST-SENTENCE-001",
        severity: "minor",
        message: "This sentence has more than three commas.",
        fix: "Consider splitting the sentence.",
        match: sentence.trim(),
        index: text.indexOf(sentence),
        endIndex: text.indexOf(sentence) + sentence.trim().length,
      },
    ];
  });
}

function dramaticPunctuationFindings(text, options) {
  if (isRawJournalContext(options)) return [];
  return matchRules(text, DRAMATIC_PUNCTUATION_RULES, "DramaticPunctuation");
}

function positioningContextFindings(text, options) {
  if (!isPositioningContext({ ...options, mode: options.mode || options.modeId })) return [];
  const context = options.positioningContext || {};
  const missing = [
    ["targetRoleFamily", "target role family"],
    ["opportunityType", "opportunity type"],
    ["audience", "audience"],
    ["posture", "posture"],
    ["evidenceEmphasis", "evidence emphasis"],
    ["boundaries", "boundaries"],
  ].filter(([key]) => isBlank(context[key]));

  if (missing.length === 0) return [];

  return [
    {
      layer: "PositioningContext",
      ruleId: "POS-CONTEXT-001",
      severity: "minor",
      message: "Positioning context is incomplete.",
      fix: `Adapt the draft to the opportunity. Missing context: ${missing.map(([, label]) => label).join(", ")}.`,
      match: text.slice(0, 120),
      index: 0,
      endIndex: text.slice(0, 120).length,
    },
  ];
}

function isRawJournalContext(options = {}) {
  const mode = String(options.mode || options.modeId || "").toLowerCase();
  const styleProfileId = String(options.styleProfileId || "").toLowerCase();
  return mode === "raw_journal" || styleProfileId === "raw-journal";
}

function groupByLayer(findings) {
  return findings.reduce((groups, finding) => {
    groups[finding.layer] ||= [];
    groups[finding.layer].push(finding);
    return groups;
  }, {});
}

function countFindings(findings) {
  return {
    total: findings.length,
    critical: findings.filter((finding) => finding.severity === "critical").length,
    major: findings.filter((finding) => finding.severity === "major").length,
    minor: findings.filter((finding) => finding.severity === "minor").length,
  };
}

function clonePattern(pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function splitSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function formatContextValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || "not supplied";
  return String(value || "").trim() || "not supplied";
}

function isBlank(value) {
  if (Array.isArray(value)) return value.filter((item) => String(item || "").trim()).length === 0;
  return !String(value || "").trim();
}
