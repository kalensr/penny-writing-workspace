import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createServer } from "../server/server.mjs";

const TEST_TOKEN = "test-penny-token";

async function withServer(callback, options = {}) {
  const server = createServer({ apiToken: TEST_TOKEN, ...options });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await callback(baseUrl);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function requestJson(baseUrl, path, options = {}) {
  const { headers = {}, ...rest } = options;
  const response = await fetch(`${baseUrl}${path}`, {
    ...rest,
    headers: {
      "content-type": "application/json",
      "x-penny-token": TEST_TOKEN,
      ...headers,
    },
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function requestText(baseUrl, requestPath, options = {}) {
  const response = await fetch(`${baseUrl}${requestPath}`, options);
  return {
    status: response.status,
    body: await response.text(),
    headers: response.headers,
  };
}

async function rawRequest(baseUrl, requestPath, { method = "GET", headers = {}, body = "" } = {}) {
  const url = new URL(`${baseUrl}${requestPath}`);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port: url.port,
        path: requestPath,
        method,
        headers,
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode,
            body: responseBody,
            headers: response.headers,
          });
        });
      },
    );
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

async function rawJsonRequest(baseUrl, requestPath, options = {}) {
  const response = await rawRequest(baseUrl, requestPath, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...options.headers,
    },
  });
  return {
    status: response.status,
    body: JSON.parse(response.body),
    headers: response.headers,
  };
}

test("Penny config endpoint exposes shared modes and style profiles", async () => {
  await withServer(async (baseUrl) => {
    const { status, body } = await requestJson(baseUrl, "/api/penny/config");

    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.workspaceSchemaVersion >= 1);
    assert.ok(body.modes.some((mode) => mode.id === "preserve_voice"));
    assert.ok(body.styleProfiles.some((profile) => profile.id === "reflective"));
    assert.ok(body.styleProfiles.some((profile) => profile.id === "executive"));
  });
});

test("Penny style-check endpoint analyzes text without calling the model", async () => {
  await withServer(async (baseUrl) => {
    const { status, body } = await requestJson(baseUrl, "/api/penny/style-check", {
      method: "POST",
      body: JSON.stringify({
        modeId: "preserve_voice",
        styleProfileId: "reflective",
        writingType: "leadership reflection",
        draft:
          "In today's rapidly evolving landscape, leaders must leverage alignment to drive transformative outcomes.",
      }),
    });

    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.styleProfile.id, "reflective");
    assert.equal(body.report.mode, "reflective");
    assert.ok(body.report.violations.some((violation) => violation.ruleId === "Voice.GenericOpening"));
    assert.equal(body.calledModel, false);
  });
});

test("Penny style-check endpoint preserves positioning context and layer metadata", async () => {
  await withServer(async (baseUrl) => {
    const { status, body } = await requestJson(baseUrl, "/api/penny/style-check", {
      method: "POST",
      body: JSON.stringify({
        modeId: "critique",
        styleProfileId: "executive",
        writingType: "recruiter-facing cover letter",
        draft: "Positions that suit my background are senior operations roles.",
        positioningContext: {
          targetRoleFamily: "technology executive",
          opportunityType: "platform modernization",
          audience: "search partner",
          posture: "exploratory",
          evidenceEmphasis: "delivery discipline",
          boundaries: "full-time roles",
        },
      }),
    });

    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.styleProfile.id, "executive");
    assert.equal(body.report.mode, "executive");
    assert.ok(body.report.styleFindings.byLayer.AIVoice.length >= 1);
    assert.ok(body.report.violations.some((violation) => violation.ruleId === "AIV-ROLE-FIT-001"));
    assert.equal(body.report.violations.some((violation) => violation.ruleId === "POS-CONTEXT-001"), false);
    assert.equal(body.calledModel, false);
  });
});

test("Penny style-check endpoint serializes new house-style layers", async () => {
  await withServer(async (baseUrl) => {
    const { status, body } = await requestJson(baseUrl, "/api/penny/style-check", {
      method: "POST",
      body: JSON.stringify({
        modeId: "critique",
        styleProfileId: "executive",
        writingType: "executive memo",
        draft: "AI is changing review workflows. This matters. The next step is to name the owner.",
      }),
    });

    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.calledModel, false);
    assert.ok(body.report.styleFindings.byLayer.CenterOfGravity.length >= 1);
    assert.ok(body.report.styleFindings.byLayer.DramaticPunctuation.length >= 1);
    assert.ok(body.report.promptSummary.includes("CenterOfGravity"));
    assert.ok(body.report.promptSummary.includes("DramaticPunctuation"));
  });
});

test("Penny API rejects missing tokens, foreign origins, and non-json writes", async () => {
  await withServer(async (baseUrl) => {
    const missingToken = await requestText(baseUrl, "/api/penny/config");
    assert.equal(missingToken.status, 403);

    const foreignOrigin = await requestJson(baseUrl, "/api/penny/config", {
      headers: { origin: "https://example.invalid" },
    });
    assert.equal(foreignOrigin.status, 403);

    const textPost = await requestJson(baseUrl, "/api/penny/style-check", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    assert.equal(textPost.status, 415);
  });
});

test("Penny API accepts explicitly configured tailnet hosts", async () => {
  await withServer(
    async (baseUrl) => {
      const { status, body } = await rawJsonRequest(baseUrl, "/api/penny/config", {
        headers: {
          host: "writer-laptop.example-tailnet.ts.net.:443",
          origin: "https://writer-laptop.example-tailnet.ts.net",
          referer: "https://writer-laptop.example-tailnet.ts.net/",
          cookie: `penny_api_token=${TEST_TOKEN}`,
        },
      });

      assert.equal(status, 200);
      assert.equal(body.ok, true);
    },
    { allowedHosts: ["writer-laptop.example-tailnet.ts.net"] },
  );
});

test("Penny API keeps tailnet hosts opt-in", async () => {
  await withServer(async (baseUrl) => {
    const defaultRejected = await rawJsonRequest(baseUrl, "/api/penny/config", {
      headers: {
        host: "writer-laptop.example-tailnet.ts.net",
        origin: "https://writer-laptop.example-tailnet.ts.net",
        cookie: `penny_api_token=${TEST_TOKEN}`,
      },
    });
    assert.equal(defaultRejected.status, 403);

    const wrongTailnet = await rawJsonRequest(baseUrl, "/api/penny/config", {
      headers: {
        host: "other-device.example-tailnet.ts.net",
        origin: "https://other-device.example-tailnet.ts.net",
        cookie: `penny_api_token=${TEST_TOKEN}`,
      },
    });
    assert.equal(wrongTailnet.status, 403);
  });
});

test("Penny API rejects adversarial tailnet host and mismatched headers", async () => {
  await withServer(
    async (baseUrl) => {
      const evilSuffix = await rawJsonRequest(baseUrl, "/api/penny/config", {
        headers: {
          host: "writer-laptop.example-tailnet.ts.net.evil.invalid",
          origin: "https://writer-laptop.example-tailnet.ts.net",
          cookie: `penny_api_token=${TEST_TOKEN}`,
        },
      });
      assert.equal(evilSuffix.status, 403);

      const mismatchedOrigin = await rawJsonRequest(baseUrl, "/api/penny/config", {
        headers: {
          host: "writer-laptop.example-tailnet.ts.net",
          origin: "https://other-device.example-tailnet.ts.net",
          cookie: `penny_api_token=${TEST_TOKEN}`,
        },
      });
      assert.equal(mismatchedOrigin.status, 403);

      const nullOrigin = await rawJsonRequest(baseUrl, "/api/penny/config", {
        headers: {
          host: "writer-laptop.example-tailnet.ts.net",
          origin: "null",
          cookie: `penny_api_token=${TEST_TOKEN}`,
        },
      });
      assert.equal(nullOrigin.status, 403);
    },
    { allowedHosts: ["writer-laptop.example-tailnet.ts.net"] },
  );
});

test("Penny API can require Tailscale identity headers for tailnet access", async () => {
  await withServer(
    async (baseUrl) => {
      const noUser = await rawJsonRequest(baseUrl, "/api/penny/config", {
        headers: {
          host: "writer-laptop.example-tailnet.ts.net",
          origin: "https://writer-laptop.example-tailnet.ts.net",
          cookie: `penny_api_token=${TEST_TOKEN}`,
        },
      });
      assert.equal(noUser.status, 403);

      const wrongUser = await rawJsonRequest(baseUrl, "/api/penny/config", {
        headers: {
          host: "writer-laptop.example-tailnet.ts.net",
          origin: "https://writer-laptop.example-tailnet.ts.net",
          "tailscale-user-login": "someone@example.com",
          cookie: `penny_api_token=${TEST_TOKEN}`,
        },
      });
      assert.equal(wrongUser.status, 403);

      const allowedUser = await rawJsonRequest(baseUrl, "/api/penny/config", {
        headers: {
          host: "writer-laptop.example-tailnet.ts.net",
          origin: "https://writer-laptop.example-tailnet.ts.net",
          "tailscale-user-login": "writer@example.com",
          cookie: `penny_api_token=${TEST_TOKEN}`,
        },
      });
      assert.equal(allowedUser.status, 200);
      assert.equal(allowedUser.body.ok, true);
    },
    {
      allowedHosts: ["writer-laptop.example-tailnet.ts.net"],
      allowedTailscaleUsers: ["writer@example.com"],
    },
  );
});

test("Penny API rejects spoofed fallback Tailscale identity headers", async () => {
  await withServer(
    async (baseUrl) => {
      const spoofedUser = await rawJsonRequest(baseUrl, "/api/penny/config", {
        headers: {
          host: "writer-laptop.example-tailnet.ts.net",
          origin: "https://writer-laptop.example-tailnet.ts.net",
          "x-tailscale-user-login": "writer@example.com",
          cookie: `penny_api_token=${TEST_TOKEN}`,
        },
      });

      assert.equal(spoofedUser.status, 403);
      assert.equal(spoofedUser.body.ok, false);
    },
    {
      allowedHosts: ["writer-laptop.example-tailnet.ts.net"],
      allowedTailscaleUsers: ["writer@example.com"],
    },
  );
});

test("Penny static shell does not mint cookies for unauthorized tailnet users", async () => {
  const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), "penny-static-"));
  await fs.writeFile(path.join(staticDir, "index.html"), "<!doctype html><title>Penny</title>", "utf8");

  await withServer(
    async (baseUrl) => {
      const response = await rawRequest(baseUrl, "/", {
        headers: {
          host: "writer-laptop.example-tailnet.ts.net",
        },
      });

      assert.equal(response.status, 403);
      assert.equal(response.headers["set-cookie"], undefined);
    },
    {
      staticDir,
      allowedHosts: ["writer-laptop.example-tailnet.ts.net"],
      allowedTailscaleUsers: ["writer@example.com"],
    },
  );
});

test("Penny runtime actions are local-only by default", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penny-runtime-action-"));
  await fs.mkdir(path.join(repoRoot, "scripts"), { recursive: true });
  const fakeRuntime = path.join(repoRoot, "scripts", "writing-runtime.sh");
  await fs.writeFile(fakeRuntime, "#!/usr/bin/env bash\necho '{\"status\":\"should-not-run\"}'\n", "utf8");
  await fs.chmod(fakeRuntime, 0o755);

  await withServer(
    async (baseUrl) => {
      const response = await rawJsonRequest(baseUrl, "/api/runtime/action", {
        method: "POST",
        headers: {
          host: "writer-laptop.example-tailnet.ts.net",
          origin: "https://writer-laptop.example-tailnet.ts.net",
          "tailscale-user-login": "writer@example.com",
          cookie: `penny_api_token=${TEST_TOKEN}`,
        },
        body: JSON.stringify({ action: "status" }),
      });

      assert.equal(response.status, 403);
      assert.equal(response.body.ok, false);
    },
    {
      repoRoot,
      allowedHosts: ["writer-laptop.example-tailnet.ts.net"],
      allowedTailscaleUsers: ["writer@example.com"],
    },
  );
});

test("Penny runtime actions can be enabled for an approved tailnet user", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penny-runtime-action-"));
  await fs.mkdir(path.join(repoRoot, "scripts"), { recursive: true });
  const fakeRuntime = path.join(repoRoot, "scripts", "writing-runtime.sh");
  await fs.writeFile(
    fakeRuntime,
    [
      "#!/usr/bin/env bash",
      "printf '{\"status\":\"ran\",\"args\":[\"%s\",\"%s\"]}\\n' \"${1:-}\" \"${2:-}\"",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.chmod(fakeRuntime, 0o755);

  await withServer(
    async (baseUrl) => {
      const response = await rawJsonRequest(baseUrl, "/api/runtime/action", {
        method: "POST",
        headers: {
          host: "writer-server.example-tailnet.ts.net",
          origin: "https://writer-server.example-tailnet.ts.net",
          "tailscale-user-login": "writer@example.com",
          cookie: `penny_api_token=${TEST_TOKEN}`,
        },
        body: JSON.stringify({ action: "swap", profile: "quality" }),
      });

      assert.equal(response.status, 200);
      assert.equal(response.body.ok, true);
      assert.deepEqual(response.body.args, ["swap", "quality"]);
      assert.match(response.body.stdout, /"status":"ran"/);
    },
    {
      repoRoot,
      allowedHosts: ["writer-server.example-tailnet.ts.net"],
      allowedTailscaleUsers: ["writer@example.com"],
      allowRemoteRuntimeControl: true,
    },
  );
});

test("shared model responses never consult the local writing runtime", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penny-shared-model-"));
  await fs.mkdir(path.join(repoRoot, "scripts"), { recursive: true });
  const marker = path.join(repoRoot, "runtime-was-called");
  const fakeRuntime = path.join(repoRoot, "scripts", "writing-runtime.sh");
  const credentialFile = path.join(repoRoot, "queue-token");
  await fs.writeFile(credentialFile, "secret\n", { mode: 0o600 });
  await fs.writeFile(fakeRuntime, `#!/usr/bin/env bash\ntouch ${JSON.stringify(marker)}\n`, "utf8");
  await fs.chmod(fakeRuntime, 0o755);

  await withServer(async (baseUrl) => {
    const response = await requestJson(baseUrl, "/api/penny/respond", {
      method: "POST",
      body: JSON.stringify({
        modeId: "revise_clarity",
        draft: "Draft.",
        instruction: "Revise.",
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    await assert.rejects(fs.access(marker));
  }, {
    repoRoot,
    modelMode: "shared",
    modelBaseUrl: "http://127.0.0.1:8092/v1",
    modelCredentialFile: credentialFile,
    modelFetch: async () => ({
      ok: true,
      json: async () => ({
        model: "gemma-runtime",
        choices: [{ message: { content: "Revised." } }],
      }),
    }),
  });
});

test("shared mode rejects local runtime status and actions", async () => {
  await withServer(async (baseUrl) => {
    const status = await requestJson(baseUrl, "/api/runtime/status");
    assert.equal(status.status, 409);
    const action = await requestJson(baseUrl, "/api/runtime/action", {
      method: "POST",
      body: JSON.stringify({ action: "start_daily" }),
    });
    assert.equal(action.status, 409);
  }, {
    modelMode: "shared",
    modelBaseUrl: "http://127.0.0.1:8092/v1",
    modelCredentialFile: "/private/token",
  });
});

test("server startup rejects invalid model client configuration", () => {
  assert.throws(() => createServer({ modelMode: "remote-ish" }), /local or shared/i);
  assert.throws(() => createServer({ modelMode: "shared", modelCredentialFile: "relative" }), /absolute path/i);
  assert.throws(() => createServer({ modelMode: "local", modelTimeoutMs: "0" }), /positive integer/i);
});

test("Penny static shell sets the local API token cookie", async () => {
  const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), "penny-static-"));
  await fs.writeFile(path.join(staticDir, "index.html"), "<!doctype html><title>Penny</title>", "utf8");

  await withServer(
    async (baseUrl) => {
      const response = await requestText(baseUrl, "/");
      assert.equal(response.status, 200);
      assert.match(response.headers.get("set-cookie") || "", /penny_api_token=test-penny-token/);
      assert.match(response.headers.get("set-cookie") || "", /HttpOnly/);
      assert.doesNotMatch(response.headers.get("set-cookie") || "", /Secure/);
    },
    { staticDir },
  );
});

test("Penny static shell secures the API cookie over approved tailnet hosts", async () => {
  const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), "penny-static-"));
  await fs.writeFile(path.join(staticDir, "index.html"), "<!doctype html><title>Penny</title>", "utf8");

  await withServer(
    async (baseUrl) => {
      const response = await rawRequest(baseUrl, "/", {
        headers: {
          host: "writer-laptop.example-tailnet.ts.net",
        },
      });
      assert.equal(response.status, 200);
      assert.match(response.headers["set-cookie"].join("; "), /HttpOnly/);
      assert.match(response.headers["set-cookie"].join("; "), /Secure/);
    },
    { staticDir, allowedHosts: ["writer-laptop.example-tailnet.ts.net"] },
  );
});

test("Penny server supports a path-scoped static shell and API", async () => {
  const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), "penny-static-"));
  await fs.writeFile(path.join(staticDir, "index.html"), "<!doctype html><title>Penny</title>", "utf8");

  await withServer(
    async (baseUrl) => {
      const shell = await requestText(baseUrl, "/penny/");
      assert.equal(shell.status, 200);
      assert.match(shell.body, /Penny/);
      assert.match(shell.headers.get("set-cookie") || "", /Path=\/penny/);

      const { status, body } = await requestJson(baseUrl, "/penny/api/penny/config");
      assert.equal(status, 200);
      assert.equal(body.ok, true);
    },
    { staticDir, basePath: "/penny" },
  );
});

test("Penny workspace GET is read-only", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penny-server-"));
  await withServer(
    async (baseUrl) => {
      const { status, body } = await requestJson(baseUrl, "/api/workspace");
      assert.equal(status, 200);
      assert.equal(body.activeProjectId, "project-writing-desk");

      const workspacePath = path.join(repoRoot, "runtime", "penny", "workspace.json");
      await assert.rejects(() => fs.stat(workspacePath), /ENOENT/);
    },
    { repoRoot },
  );
});

test("Penny workspace writes use private directory and file permissions", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penny-server-"));
  await withServer(
    async (baseUrl) => {
      const { status, body } = await requestJson(baseUrl, "/api/workspace", {
        method: "POST",
        body: JSON.stringify({
          activeProjectId: "project-writing-desk",
          projects: [
            {
              id: "project-writing-desk",
              name: "Writing Desk",
              activeDocumentId: "doc-test",
              documents: [
                {
                  id: "doc-test",
                  title: "Private Draft",
                  writingType: "memo",
                  body: "private text",
                },
              ],
            },
          ],
        }),
      });
      assert.equal(status, 200);
      assert.equal(body.activeProjectId, "project-writing-desk");

      const storeDir = path.join(repoRoot, "runtime", "penny");
      const workspacePath = path.join(storeDir, "workspace.json");
      const dirMode = (await fs.stat(storeDir)).mode & 0o777;
      const fileMode = (await fs.stat(workspacePath)).mode & 0o777;
      assert.equal(dirMode, 0o700);
      assert.equal(fileMode, 0o600);
    },
    { repoRoot },
  );
});
