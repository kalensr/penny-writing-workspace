import { buildPennyMessages, getPennyMode } from "./prompt_contract.mjs";
import { assertLoopbackModelBaseUrl } from "./runtime_adapter.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  analyzeVoice,
  applySafeMechanicalFixes,
} from "./voice_rules.mjs";

const MLX_DEFAULT_MODEL = "default_model";
const SHARED_MODEL_ALIAS = "penny-writing";

function positiveTimeout(value, fallback) {
  const timeout = Number(value === undefined || value === "" ? fallback : value);
  if (!Number.isFinite(timeout) || !Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new Error("PENNY_MODEL_TIMEOUT_MS must be a positive integer.");
  }
  return timeout;
}

export function resolveModelClientConfig(options = {}) {
  const modelMode = String(options.modelMode || process.env.PENNY_MODEL_MODE || "local").trim().toLowerCase();
  if (!["local", "shared"].includes(modelMode)) {
    throw new Error("PENNY_MODEL_MODE must be local or shared.");
  }
  if (modelMode === "shared" && (options.credential || process.env.PENNY_MODEL_CREDENTIAL)) {
    throw new Error("Shared model authentication requires a credential file; inline credentials are not accepted.");
  }
  const modelBaseUrl = assertLoopbackModelBaseUrl(
    options.modelBaseUrl || process.env.PENNY_MODEL_BASE_URL || "http://127.0.0.1:8091/v1",
  );
  const credentialFile = options.credentialFile || process.env.PENNY_MODEL_CREDENTIAL_FILE || "";
  if (modelMode === "shared" && !credentialFile) {
    throw new Error("Shared model mode requires PENNY_MODEL_CREDENTIAL_FILE.");
  }
  if (modelMode === "shared" && !path.isAbsolute(credentialFile)) {
    throw new Error("PENNY_MODEL_CREDENTIAL_FILE must be an absolute path.");
  }
  const credentialReader = async () => {
    let handle;
    try {
      const noFollow = fs.constants?.O_NOFOLLOW || 0;
      handle = await fs.open(credentialFile, fs.constants.O_RDONLY | noFollow);
      const info = await handle.stat();
      const ownerMatches = typeof process.getuid !== "function" || info.uid === process.getuid();
      if (!info.isFile() || !ownerMatches || (info.mode & 0o777) !== 0o600) {
        throw new Error("unsafe");
      }
      const token = String(await handle.readFile({ encoding: "utf8" })).trim();
      if (!token) throw new Error("unsafe");
      return token;
    } catch {
      throw new Error("Shared model credential file is unavailable or unsafe.");
    } finally {
      await handle?.close().catch(() => {});
    }
  };
  return {
    modelMode,
    modelBaseUrl,
    model: modelMode === "shared" ? SHARED_MODEL_ALIAS : MLX_DEFAULT_MODEL,
    timeoutMs: positiveTimeout(
      options.timeoutMs !== undefined ? options.timeoutMs : process.env.PENNY_MODEL_TIMEOUT_MS,
      modelMode === "shared" ? 420000 : 120000,
    ),
    async authorization() {
      if (modelMode !== "shared") return "";
      let token;
      try {
        token = String(await credentialReader()).trim();
      } catch {
        throw new Error("Shared model credential file is unavailable or unsafe.");
      }
      if (!token) throw new Error("Shared model credential file is unavailable or unsafe.");
      return `Bearer ${token}`;
    },
  };
}

export function buildChatCompletionPayload(request, options = {}) {
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
    model: options.model || MLX_DEFAULT_MODEL,
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
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sourceStyleReport = analyzeVoice(request.selectedText || request.draft || "", {
    modeId: request.modeId,
    writingType: request.writingType,
    styleProfileId: request.styleProfileId,
    positioningContext: request.positioningContext,
  });
  let client;
  try {
    client = options.clientConfig || resolveModelClientConfig(options);
  } catch (error) {
    return offlinePennyResponse(error.message, request, "configuration");
  }
  const payload = buildChatCompletionPayload(
    { ...request, styleReport: sourceStyleReport },
    { model: client.model },
  );

  try {
    const authorization = await client.authorization();
    const headers = { "content-type": "application/json" };
    if (authorization) headers.authorization = authorization;
    const response = await fetchImpl(`${client.modelBaseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(client.timeoutMs),
    });

    if (!response.ok) {
      let serviceError = "";
      try {
        const body = await response.json();
        serviceError = typeof body?.error === "string" ? body.error.trim().toLowerCase() : "";
      } catch {
        // Error bodies are optional; status still provides a stable fallback.
      }
      const errorKind = response.status === 504 && serviceError === "queue_wait_timeout"
        ? "wait_timeout"
        : response.status === 429
        ? "queue_wait"
        : response.status === 503
          ? "service_unavailable"
          : "generation";
      const detail = serviceError ? ` (${serviceError})` : "";
      return offlinePennyResponse(`model service returned HTTP ${response.status}${detail}`, request, errorKind);
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
      requestedModel: client.model,
      actualModel: typeof completion.model === "string" && completion.model.trim()
        ? completion.model.trim()
        : null,
    };
  } catch (error) {
    const errorKind = error?.name === "TimeoutError" || error?.name === "AbortError"
      ? "wait_timeout"
      : error instanceof TypeError
        ? "connection"
        : "configuration";
    return offlinePennyResponse(error.message, request, errorKind);
  }
}

export function offlinePennyResponse(reason, request = {}, errorKind = "connection") {
  const mode = request.modeId ? getPennyMode(request.modeId) : null;
  const contentByKind = {
    queue_wait: "The shared Penny model queue is full. Your draft is safe; wait for an active request to finish, then try again.",
    service_unavailable: "The shared Penny model service is temporarily unavailable. Your draft is safe; try again after the service recovers.",
    wait_timeout: "Penny waited for the model but the request did not finish in time. Your draft is safe; check queue status before retrying.",
    generation: "The model accepted Penny's request but could not complete the generation. Your draft is safe; retry once or check the model service.",
    configuration: "Penny's model connection is not configured safely. Your draft is safe; check the shared model settings and credential file.",
    connection: "Penny cannot reach the writing model. Your draft is safe; check the local endpoint or shared-model tunnel, then try again.",
  };
  return {
    ok: false,
    offline: ["connection", "service_unavailable", "configuration"].includes(errorKind),
    waiting: ["queue_wait", "wait_timeout"].includes(errorKind),
    generationError: errorKind === "generation",
    modeId: request.modeId || null,
    runtimeProfile: mode?.runtimeProfile || "daily",
    errorKind,
    content: contentByKind[errorKind] || contentByKind.connection,
    reason,
  };
}
