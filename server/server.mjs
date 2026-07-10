import fs from "node:fs/promises";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  WORKSPACE_SCHEMA_VERSION,
  configureStyleProfiles,
  resolveStyleProfile,
  listPennyModes,
  listStyleProfiles,
} from "./domain.mjs";
import { askPenny, resolveModelClientConfig } from "./penny_agent.mjs";
import { parseRuntimeStatusModel, runWritingRuntime } from "./runtime_adapter.mjs";
import { readWorkspace, writeWorkspace } from "./storage.mjs";
import { analyzeVoice, configureVoiceAnalysis } from "./voice_rules.mjs";
import { loadVoicePackConfiguration } from "./voice_pack_loader.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_STATIC_DIR = path.join(REPO_ROOT, "app", "dist");
const HOST = "127.0.0.1";
const DEFAULT_PORT = 4177;
const MAX_BODY_BYTES = 1_000_000;
const API_COOKIE_NAME = "penny_api_token";
const DEFAULT_API_TOKEN = crypto.randomUUID();

function normalizeAllowedHost(value = "") {
  const trimmed = String(value || "").trim().toLowerCase().replace(/\.+$/, "");
  if (!trimmed) return "";
  try {
    const parsed = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    return parsed.hostname.replace(/\.+$/, "");
  } catch {
    return "";
  }
}

function parseCommaSeparated(values = []) {
  return values.flatMap((value) => String(value || "").split(","));
}

function parseAllowedHosts(values = []) {
  const hosts = parseCommaSeparated(values)
    .map(normalizeAllowedHost)
    .filter(Boolean);
  return [...new Set(hosts)];
}

function parseAllowedTailscaleUsers(values = []) {
  const users = parseCommaSeparated(values)
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(users)];
}

function normalizeBasePath(value = "") {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === "/") return "";
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

function parseBoolean(value = "") {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function parseArgs(argv) {
  const args = {
    host: HOST,
    port: DEFAULT_PORT,
    staticDir: DEFAULT_STATIC_DIR,
    stateDir: process.env.PENNY_STATE_DIR || "",
    basePath: normalizeBasePath(process.env.PENNY_BASE_PATH || ""),
    allowRemoteRuntimeControl: parseBoolean(process.env.PENNY_ALLOW_REMOTE_RUNTIME_CONTROL || ""),
    allowedHosts: parseAllowedHosts([process.env.PENNY_ALLOWED_HOSTS || ""]),
    allowedTailscaleUsers: parseAllowedTailscaleUsers([process.env.PENNY_TAILSCALE_USERS || ""]),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") args.port = Number(argv[++index]);
    if (arg === "--static") args.staticDir = path.resolve(argv[++index]);
    if (arg === "--state-dir") args.stateDir = path.resolve(argv[++index]);
    if (arg === "--base-path") args.basePath = normalizeBasePath(argv[++index]);
    if (arg === "--allow-remote-runtime-control") args.allowRemoteRuntimeControl = true;
    if (arg === "--allowed-host") args.allowedHosts.push(...parseAllowedHosts([argv[++index]]));
    if (arg === "--tailscale-user") {
      args.allowedTailscaleUsers.push(...parseAllowedTailscaleUsers([argv[++index]]));
    }
  }
  args.allowedHosts = parseAllowedHosts(args.allowedHosts);
  args.allowedTailscaleUsers = parseAllowedTailscaleUsers(args.allowedTailscaleUsers);
  return args;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

async function readJsonBody(request) {
  let size = 0;
  let body = "";
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Request body too large.");
    }
    body += chunk.toString();
  }
  return body ? JSON.parse(body) : {};
}

function loopbackHostname(hostname = "") {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

function allowedTailnetHostname(hostname = "", allowedHosts = []) {
  const normalized = normalizeAllowedHost(hostname);
  return Boolean(normalized && allowedHosts.includes(normalized));
}

function hostHeaderHostname(value = "") {
  try {
    const parsed = new URL(`http://${value}`);
    return normalizeAllowedHost(parsed.hostname);
  } catch {
    return "";
  }
}

function allowedHostHeader(value = "", allowedHosts = []) {
  const hostname = hostHeaderHostname(value);
  return loopbackHostname(hostname) || allowedTailnetHostname(hostname, allowedHosts);
}

function allowedHeaderUrl(value = "", allowedHosts = []) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" && loopbackHostname(parsed.hostname)) return true;
    return parsed.protocol === "https:" && allowedTailnetHostname(parsed.hostname, allowedHosts);
  } catch {
    return false;
  }
}

function headerUrlMatchesTailnetHost(value = "", hostHeader = "", allowedHosts = []) {
  const hostHostname = hostHeaderHostname(hostHeader);
  if (!allowedTailnetHostname(hostHostname, allowedHosts)) return true;
  try {
    const parsed = new URL(value);
    return normalizeAllowedHost(parsed.hostname) === hostHostname;
  } catch {
    return false;
  }
}

function tailnetRequestHost(value = "", allowedHosts = []) {
  const hostname = hostHeaderHostname(value);
  return allowedTailnetHostname(hostname, allowedHosts) && !loopbackHostname(hostname);
}

function validApiToken(request, apiToken) {
  const headerToken = request.headers["x-penny-token"];
  if (headerToken === apiToken) return true;
  const cookie = request.headers.cookie || "";
  return cookie
    .split(";")
    .map((part) => part.trim())
    .some((part) => part === `${API_COOKIE_NAME}=${apiToken}`);
}

function validTailscaleUser(request, allowedHosts = [], allowedTailscaleUsers = []) {
  if (!tailnetRequestHost(request.headers.host || "", allowedHosts)) return true;
  if (allowedTailscaleUsers.length === 0) return true;
  const user = String(request.headers["tailscale-user-login"] || "").trim().toLowerCase();
  return allowedTailscaleUsers.includes(user);
}

function validateApiRequest(request, apiToken, allowedHosts = [], allowedTailscaleUsers = []) {
  const hostHeader = request.headers.host || "";
  const hostOk = allowedHostHeader(hostHeader, allowedHosts);
  if (!hostOk) return { ok: false, statusCode: 403, error: "Penny API only accepts approved local or tailnet hosts." };

  const origin = request.headers.origin;
  if (origin && !allowedHeaderUrl(origin, allowedHosts)) {
    return { ok: false, statusCode: 403, error: "Penny API rejected a foreign origin." };
  }
  if (origin && !headerUrlMatchesTailnetHost(origin, hostHeader, allowedHosts)) {
    return { ok: false, statusCode: 403, error: "Penny API rejected a mismatched tailnet origin." };
  }

  const referer = request.headers.referer;
  if (referer && !allowedHeaderUrl(referer, allowedHosts)) {
    return { ok: false, statusCode: 403, error: "Penny API rejected a foreign referer." };
  }
  if (referer && !headerUrlMatchesTailnetHost(referer, hostHeader, allowedHosts)) {
    return { ok: false, statusCode: 403, error: "Penny API rejected a mismatched tailnet referer." };
  }

  if (!validTailscaleUser(request, allowedHosts, allowedTailscaleUsers)) {
    return { ok: false, statusCode: 403, error: "Penny API rejected an unauthorized tailnet user." };
  }

  if (!validApiToken(request, apiToken)) {
    return { ok: false, statusCode: 403, error: "Penny API token is missing or invalid." };
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    const contentType = request.headers["content-type"] || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return { ok: false, statusCode: 415, error: "Penny API requires application/json requests." };
    }
  }

  return { ok: true };
}

function validateStaticRequest(request, allowedHosts = [], allowedTailscaleUsers = []) {
  if (!allowedHostHeader(request.headers.host || "", allowedHosts)) {
    return { ok: false, statusCode: 403, error: "Forbidden" };
  }
  if (!validTailscaleUser(request, allowedHosts, allowedTailscaleUsers)) {
    return { ok: false, statusCode: 403, error: "Forbidden" };
  }
  return { ok: true };
}

function staticHeaders(filePath, apiToken, request, allowedHosts = [], cookiePath = "/") {
  const safeCookiePath = cookiePath && cookiePath.startsWith("/") ? cookiePath : "/";
  const cookieAttributes = [`${API_COOKIE_NAME}=${apiToken}`, `Path=${safeCookiePath}`, "SameSite=Strict", "HttpOnly"];
  if (tailnetRequestHost(request?.headers?.host || "", allowedHosts)) cookieAttributes.push("Secure");
  return {
    "content-type": contentTypeFor(filePath),
    "cache-control": "no-store",
    "set-cookie": cookieAttributes.join("; "),
  };
}

async function serveStatic(request, response, staticDir, urlPath, apiToken, allowedHosts, allowedTailscaleUsers, basePath) {
  const validation = validateStaticRequest(request, allowedHosts, allowedTailscaleUsers);
  if (!validation.ok) {
    response.writeHead(validation.statusCode);
    response.end(validation.error);
    return;
  }

  const decodedPath = decodeURIComponent(urlPath.split("?")[0]);
  const safePath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const target = safePath === "/" ? "index.html" : safePath.replace(/^\/+/, "");
  const filePath = path.join(staticDir, target);
  const resolved = path.resolve(filePath);
  const staticRoot = path.resolve(staticDir);

  if (!resolved.startsWith(staticRoot)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const bytes = await fs.readFile(resolved);
    response.writeHead(200, staticHeaders(resolved, apiToken, request, allowedHosts, basePath || "/"));
    response.end(bytes);
  } catch {
    const fallback = path.join(staticDir, "index.html");
    const bytes = await fs.readFile(fallback);
    response.writeHead(200, staticHeaders(fallback, apiToken, request, allowedHosts, basePath || "/"));
    response.end(bytes);
  }
}

async function handleApi(
  request,
  response,
  pathname,
  { apiToken, repoRoot, stateDir, allowedHosts, allowedTailscaleUsers, allowRemoteRuntimeControl, voicePackConfig, modelOptions },
) {
  const validation = validateApiRequest(request, apiToken, allowedHosts, allowedTailscaleUsers);
  if (!validation.ok) {
    sendJson(response, validation.statusCode, { ok: false, error: validation.error });
    return;
  }

  if (request.method === "GET" && pathname === "/api/penny/config") {
    sendJson(response, 200, {
      ok: true,
      workspaceSchemaVersion: WORKSPACE_SCHEMA_VERSION,
      modes: listPennyModes(),
      styleProfiles: listStyleProfiles(),
      defaultStyleProfileId: voicePackConfig.defaultProfileId,
      voicePackWarnings: voicePackConfig.warnings,
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/runtime/status") {
    if (modelOptions.modelMode === "shared") {
      sendJson(response, 409, { ok: false, error: "Local runtime control is disabled in shared model mode." });
      return;
    }
    const result = await runWritingRuntime(repoRoot, { action: "status" });
    sendJson(response, result.ok ? 200 : 502, result);
    return;
  }

  if (request.method === "POST" && pathname === "/api/runtime/action") {
    if (modelOptions.modelMode === "shared") {
      sendJson(response, 409, { ok: false, error: "Local runtime control is disabled in shared model mode." });
      return;
    }
    if (tailnetRequestHost(request.headers.host || "", allowedHosts) && !allowRemoteRuntimeControl) {
      sendJson(response, 403, { ok: false, error: "Penny runtime actions are local-only by default." });
      return;
    }
    const body = await readJsonBody(request);
    const result = await runWritingRuntime(repoRoot, body);
    sendJson(response, result.ok ? 200 : 400, result);
    return;
  }

  if (request.method === "GET" && pathname === "/api/workspace") {
    sendJson(response, 200, await readWorkspace(repoRoot, stateDir));
    return;
  }

  if (request.method === "POST" && pathname === "/api/workspace") {
    const body = await readJsonBody(request);
    sendJson(response, 200, await writeWorkspace(body, repoRoot, stateDir));
    return;
  }

  if (request.method === "POST" && pathname === "/api/penny/respond") {
    const body = await readJsonBody(request);
    let activeModel = null;
    if (modelOptions.modelMode !== "shared") {
      const runtimeStatus = await runWritingRuntime(repoRoot, { action: "status" });
      activeModel = parseRuntimeStatusModel(runtimeStatus);
    }
    const result = await askPenny({ ...body, model: body.model || activeModel }, modelOptions);
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && pathname === "/api/penny/style-check") {
    const body = await readJsonBody(request);
    const report = analyzeVoice(body.selectedText || body.draft || "", {
      modeId: body.modeId,
      writingType: body.writingType,
      styleProfileId: body.styleProfileId,
      positioningContext: body.positioningContext,
      sourceText: body.sourceText || "",
    });
    sendJson(response, 200, {
      ok: true,
      calledModel: false,
      styleProfile: resolveStyleProfile(body.styleProfileId || report.styleProfile.id).profile,
      report,
    });
    return;
  }

  sendJson(response, 404, { ok: false, error: "Unknown Penny API route." });
}

export function createServer({
  staticDir = DEFAULT_STATIC_DIR,
  apiToken = DEFAULT_API_TOKEN,
  repoRoot = REPO_ROOT,
  stateDir = process.env.PENNY_STATE_DIR || "",
  allowedHosts = [],
  allowedTailscaleUsers = [],
  basePath = "",
  allowRemoteRuntimeControl = false,
  voicePackDir = process.env.PENNY_VOICE_PACK_DIR || "",
  modelMode = process.env.PENNY_MODEL_MODE || "local",
  modelBaseUrl = process.env.PENNY_MODEL_BASE_URL || "http://127.0.0.1:8091/v1",
  modelCredentialFile = process.env.PENNY_MODEL_CREDENTIAL_FILE || "",
  modelTimeoutMs = process.env.PENNY_MODEL_TIMEOUT_MS || "",
  modelFetch,
} = {}) {
  const voicePackConfig = loadVoicePackConfiguration({ packDir: voicePackDir });
  configureStyleProfiles(voicePackConfig.profiles, voicePackConfig.defaultProfileId);
  configureVoiceAnalysis(voicePackConfig.analysisByProfile);
  const normalizedAllowedHosts = parseAllowedHosts(allowedHosts);
  const normalizedAllowedTailscaleUsers = parseAllowedTailscaleUsers(allowedTailscaleUsers);
  const normalizedBasePath = normalizeBasePath(basePath);
  const clientConfig = resolveModelClientConfig({
    modelMode: String(modelMode).trim().toLowerCase(),
    modelBaseUrl,
    credentialFile: modelCredentialFile,
    timeoutMs: modelTimeoutMs,
  });
  const modelOptions = {
    modelMode: clientConfig.modelMode,
    clientConfig,
    ...(modelFetch ? { fetchImpl: modelFetch } : {}),
  };
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${HOST}`);
      let pathname = url.pathname;
      if (normalizedBasePath) {
        if (pathname === normalizedBasePath) {
          response.writeHead(308, { location: `${normalizedBasePath}/` });
          response.end();
          return;
        }
        if (!pathname.startsWith(`${normalizedBasePath}/`)) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }
        pathname = pathname.slice(normalizedBasePath.length) || "/";
      }
      if (pathname.startsWith("/api/")) {
        await handleApi(request, response, pathname, {
          apiToken,
          repoRoot,
          stateDir,
          allowedHosts: normalizedAllowedHosts,
          allowedTailscaleUsers: normalizedAllowedTailscaleUsers,
          allowRemoteRuntimeControl,
          voicePackConfig,
          modelOptions,
        });
      } else {
        await serveStatic(
          request,
          response,
          staticDir,
          pathname,
          apiToken,
          normalizedAllowedHosts,
          normalizedAllowedTailscaleUsers,
          normalizedBasePath,
        );
      }
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const server = createServer({
    staticDir: args.staticDir,
    stateDir: args.stateDir,
    allowedHosts: args.allowedHosts,
    allowedTailscaleUsers: args.allowedTailscaleUsers,
    basePath: args.basePath,
    allowRemoteRuntimeControl: args.allowRemoteRuntimeControl,
  });
  server.listen(args.port, args.host, () => {
    console.log(`Penny writing workspace: http://${args.host}:${args.port}`);
  });
}
