import assert from "node:assert/strict";
import { test } from "node:test";

import { askPenny, checkPennyStyle, resolveApiPath } from "../app/src/lib/apiClient.js";

test("resolveApiPath targets root API when Penny is served at root", () => {
  assert.equal(resolveApiPath("/api/workspace", "http://127.0.0.1:4177/"), "/api/workspace");
});

test("resolveApiPath targets prefixed API when Penny is served under a path", () => {
  assert.equal(
    resolveApiPath("/api/workspace", "https://writer-server.example-tailnet.ts.net/penny/"),
    "/penny/api/workspace",
  );
});

test("resolveApiPath treats extensionless prefix URLs as directories", () => {
  assert.equal(
    resolveApiPath("/api/penny/config", "https://writer-server.example-tailnet.ts.net/penny?smoke=1"),
    "/penny/api/penny/config",
  );
});

test("askPenny forwards AbortController signal to fetch", async () => {
  const controller = new AbortController();
  const originalFetch = globalThis.fetch;
  let observedSignal = null;
  globalThis.fetch = async (_path, options = {}) => {
    observedSignal = options.signal;
    return {
      ok: true,
      async json() {
        return { ok: true, content: "Done." };
      },
    };
  };

  try {
    await askPenny({ draft: "Draft." }, { signal: controller.signal });
    assert.equal(observedSignal, controller.signal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("checkPennyStyle forwards AbortController signal to fetch", async () => {
  const controller = new AbortController();
  const originalFetch = globalThis.fetch;
  let observedSignal = null;
  globalThis.fetch = async (_path, options = {}) => {
    observedSignal = options.signal;
    return {
      ok: true,
      async json() {
        return { ok: true, report: { voiceScore: 90 } };
      },
    };
  };

  try {
    await checkPennyStyle({ draft: "Draft." }, { signal: controller.signal });
    assert.equal(observedSignal, controller.signal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
