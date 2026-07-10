import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ALLOWED_ACTIONS = new Set(["start_daily", "stop", "smoke", "status", "swap"]);
const ALLOWED_PROFILES = new Set(["daily", "quality"]);

export function assertLoopbackModelBaseUrl(baseUrl) {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new Error("Penny model base URL must use an HTTP loopback host.");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function mapRuntimeAction(request) {
  const action = request?.action;
  if (!ALLOWED_ACTIONS.has(action)) {
    throw new Error(`Unsupported runtime action: ${action}`);
  }

  if (action === "start_daily") return ["on"];
  if (action === "stop") return ["off"];
  if (action === "smoke") return ["smoke"];
  if (action === "status") return ["status"];

  const profile = request?.profile;
  if (!ALLOWED_PROFILES.has(profile)) {
    throw new Error(`Unsupported runtime profile: ${profile}`);
  }
  return ["swap", profile];
}

export function parseRuntimeStatusModel(result) {
  if (!result?.ok || !result.stdout) return null;
  try {
    const status = JSON.parse(result.stdout);
    const model = status?.state?.model;
    return typeof model === "string" && model.trim() ? model.trim() : null;
  } catch {
    return null;
  }
}

export function runWritingRuntime(repoRoot, request) {
  const args = mapRuntimeAction(request);
  const script = process.env.PENNY_RUNTIME_SCRIPT || path.join(repoRoot, "scripts", "writing-runtime.sh");
  try {
    fs.accessSync(script, fs.constants.X_OK);
  } catch {
    return Promise.resolve({
      code: 127,
      ok: false,
      args,
      stdout: "",
      stderr: `Penny runtime control unavailable: set PENNY_RUNTIME_SCRIPT to an executable writing runtime control script.`,
      unavailable: true,
    });
  }

  return new Promise((resolve) => {
    const child = spawn(script, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({
        code,
        ok: code === 0,
        args,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}
