function ensureDirectoryUrl(href) {
  const url = new URL(href);
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  }
  return url;
}

export function resolveApiPath(path, href = globalThis.location?.href || "http://127.0.0.1/") {
  if (!String(path).startsWith("/api/")) return path;
  const relativePath = String(path).replace(/^\/+/, "");
  const url = new URL(relativePath, ensureDirectoryUrl(href));
  return `${url.pathname}${url.search}`;
}

async function requestJson(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const response = await fetch(resolveApiPath(path), {
    credentials: "same-origin",
    ...rest,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || body.stderr || `Request failed: ${response.status}`);
  }
  return body;
}

export function fetchWorkspace() {
  return requestJson("/api/workspace");
}

export function saveWorkspace(workspace) {
  return requestJson("/api/workspace", {
    method: "POST",
    body: JSON.stringify(workspace),
  });
}

export function fetchRuntimeStatus() {
  return requestJson("/api/runtime/status");
}

export function runRuntimeAction(action) {
  return requestJson("/api/runtime/action", {
    method: "POST",
    body: JSON.stringify(action),
  });
}

export function askPenny(payload, options = {}) {
  return requestJson("/api/penny/respond", {
    method: "POST",
    body: JSON.stringify(payload),
    signal: options.signal,
  });
}

export function fetchPennyConfig() {
  return requestJson("/api/penny/config");
}

export function checkPennyStyle(payload, options = {}) {
  return requestJson("/api/penny/style-check", {
    method: "POST",
    body: JSON.stringify(payload),
    signal: options.signal,
  });
}
