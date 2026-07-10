import { buildPennyMessages, getPennyMode } from "./prompt_contract.mjs";
import { assertLoopbackModelBaseUrl } from "./runtime_adapter.mjs";
import {
  analyzeVoice,
  applySafeMechanicalFixes,
} from "./voice_rules.mjs";

const DEFAULT_MODEL_BASE_URL = process.env.PENNY_MODEL_BASE_URL || "http://127.0.0.1:8091/v1";
const MLX_DEFAULT_MODEL = "default_model";

export function buildChatCompletionPayload(request) {
  const mode = getPennyMode(request.modeId);
  const sourceStyleReport =
    request.styleReport ||
    analyzeVoice(request.selectedText || request.draft || "", {
      modeId: request.modeId,
      writingType: request.writingType,
      styleProfileId: request.styleProfileId,
      positioningContext: request.positioningContext,
    });
  return {
    model: MLX_DEFAULT_MODEL,
    messages: buildPennyMessages({ ...request, styleReport: sourceStyleReport }),
    temperature: mode.runtimeProfile === "quality" ? 0.25 : 0.35,
    max_tokens: mode.runtimeProfile === "quality" ? 1300 : 650,
  };
}

export function extractAssistantText(completion) {
  const message = completion?.choices?.[0]?.message;
  return message?.content?.trim() || message?.reasoning?.trim() || "";
}

function extractJsonArrayText(text = "") {
  const raw = String(text || "").trim();
  if (!raw || !raw.startsWith("[") || !raw.endsWith("]")) {
    throw new Error("Penny did not return valid inline annotations.");
  }
  return raw;
}

function normalizeInlineNote(note) {
  const value = String(note || "").replace(/\s+/g, " ").trim();
  if (!value) {
    throw new Error("Penny did not return valid inline annotations.");
  }
  if (/^\[Penny note:.+\]$/i.test(value)) {
    return value.replace(/^\[penny note:/i, "[Penny note:");
  }
  const withoutBrackets = value.replace(/^\[/, "").replace(/\]$/, "").trim();
  return `[Penny note: ${withoutBrackets}]`;
}

export function parseInlineAnnotations(text = "") {
  let parsed;
  try {
    parsed = JSON.parse(extractJsonArrayText(text));
  } catch {
    throw new Error("Penny did not return valid inline annotations.");
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Penny did not return valid inline annotations.");
  }

  const annotations = parsed.map((item) => {
    const anchorText = String(item?.anchorText || "").trim();
    const position = String(item?.position || "after").trim().toLowerCase();
    if (!anchorText || !["before", "after"].includes(position)) {
      throw new Error("Penny did not return valid inline annotations.");
    }
    return {
      anchorText,
      position,
      note: normalizeInlineNote(item?.note),
    };
  });

  return annotations;
}

export function contractErrorPennyResponse(reason, request = {}) {
  const mode = request.modeId ? getPennyMode(request.modeId) : null;
  return {
    ok: false,
    offline: false,
    contractError: true,
    modeId: request.modeId || null,
    runtimeProfile: mode?.runtimeProfile || "daily",
    content:
      "Penny reached the local model, but the response did not match the inline-notes contract. Try drafting the inline notes again.",
    reason,
  };
}

function summarizeInlineAnnotations(annotations) {
  const count = annotations.length;
  return `${count} inline ${count === 1 ? "note" : "notes"} ready for review.`;
}

export function cleanPennyText(text = "", options = {}) {
  const preserveMarkdown = options.voiceMode === "raw_journal" || options.preserveMarkdown;
  if (preserveMarkdown) {
    return applySafeMechanicalFixes(text, { preserveMarkdown: true });
  }

  const withoutMarkdown = applySafeMechanicalFixes(text)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      if (/^\s*[*_-]{3,}\s*$/.test(line)) {
        return "";
      }

      if (/^\s{0,3}#{1,6}\s*$/.test(line)) {
        return "";
      }

      return line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s{0,3}>\s?/, "")
        .replace(/^\s{0,3}[-*+]\s+/, "- ")
        .replace(/\$?\\rightarrow\$?/g, "->")
        .replace(/\u2192/g, "->")
        .replace(/\*\*([^*\n]+)\*\*/g, "$1")
        .replace(/__([^_\n]+)__/g, "$1")
        .replace(/\*([^*\n]+)\*/g, "$1")
        .replace(/_([^_\n]+)_/g, "$1")
        .replace(/`([^`\n]+)`/g, "$1")
        .trimEnd();
    })
    .join("\n");

  return withoutMarkdown.replace(/\n{3,}/g, "\n\n").trim();
}

export async function askPenny(request, options = {}) {
  const modelBaseUrl = assertLoopbackModelBaseUrl(options.modelBaseUrl || DEFAULT_MODEL_BASE_URL);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sourceStyleReport = analyzeVoice(request.selectedText || request.draft || "", {
    modeId: request.modeId,
    writingType: request.writingType,
    styleProfileId: request.styleProfileId,
    positioningContext: request.positioningContext,
  });
  const payload = buildChatCompletionPayload({ ...request, styleReport: sourceStyleReport });

  try {
    const response = await fetchImpl(`${modelBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(options.timeoutMs || 120000),
    });

    if (!response.ok) {
      return offlinePennyResponse(`local model returned HTTP ${response.status}`, request);
    }

    const completion = await response.json();
    const assistantText = extractAssistantText(completion);
    let inlineAnnotations = null;
    if (request.operation === "inline_annotations") {
      try {
        inlineAnnotations = parseInlineAnnotations(assistantText);
      } catch (error) {
        return contractErrorPennyResponse(error.message, request);
      }
    }
    const content = inlineAnnotations
      ? summarizeInlineAnnotations(inlineAnnotations)
      : cleanPennyText(assistantText, { voiceMode: sourceStyleReport.mode });
    if (!content) {
      return offlinePennyResponse("local model returned an empty response", request);
    }

    const responseStyleReport = inlineAnnotations
      ? undefined
      : analyzeVoice(content, {
          modeId: request.modeId,
          writingType: request.writingType,
          styleProfileId: request.styleProfileId,
          positioningContext: request.positioningContext,
          sourceText: request.selectedText || request.draft || "",
        });

    return {
      ok: true,
      offline: false,
      modeId: request.modeId,
      runtimeProfile: getPennyMode(request.modeId).runtimeProfile,
      styleProfileId: sourceStyleReport.styleProfile.id,
      sourceStyleReport,
      responseStyleReport,
      content,
      applyMode: inlineAnnotations ? "annotate" : undefined,
      inlineAnnotations: inlineAnnotations || undefined,
      usage: completion.usage || null,
    };
  } catch (error) {
    return offlinePennyResponse(error.message, request);
  }
}

export function offlinePennyResponse(reason, request = {}) {
  const mode = request.modeId ? getPennyMode(request.modeId) : null;
  return {
    ok: false,
    offline: true,
    modeId: request.modeId || null,
    runtimeProfile: mode?.runtimeProfile || "daily",
    content:
      "Penny cannot reach the local writing model yet. Start the daily model, then try again. Your draft stayed local and no cloud service was called.",
    reason,
  };
}
