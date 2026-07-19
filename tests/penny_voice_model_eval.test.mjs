import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  VOICE_EVAL_CASES,
  parseArgs,
  resolveEvalPaths,
  validateLoopbackBaseUrl,
} from "../scripts/run_voice_model_eval.mjs";

test("voice model evaluation pins the three Kalen voice cases and established caps", () => {
  assert.deepEqual(
    VOICE_EVAL_CASES.map(({ id, maxTokens }) => [id, maxTokens]),
    [
      ["11-real-voice-preservation", 850],
      ["12-rough-to-polished", 1300],
      ["13-polished-style-analysis", 850],
    ],
  );
});

test("voice model evaluation prompts remain byte-stable for historical comparison", () => {
  const expected = {
    "11-real-voice-preservation.md": "e50b7bd3ded127f1b483ea7183f35a7126ee7cfb470e5997841af91a81867539",
    "12-rough-to-polished-voice.md": "33e78a237aecdd9ec22b3fc0f3c3dd65bd2708ad7a532c30b89247bdc4bda5df",
    "13-polished-reference-style-analysis.md": "19651c667f8f903897bdab59701a7d9406c1ec2c8543d939d0bc0626f9c58cdd",
  };
  for (const [fileName, expectedHash] of Object.entries(expected)) {
    const contents = readFileSync(path.resolve("evals", "voice-model", "prompts", fileName));
    assert.equal(createHash("sha256").update(contents).digest("hex"), expectedHash);
  }
});

test("voice model evaluation accepts only explicit loopback HTTP endpoints", () => {
  assert.equal(validateLoopbackBaseUrl("http://127.0.0.1:8091/v1"), "http://127.0.0.1:8091/v1");
  assert.equal(validateLoopbackBaseUrl("http://localhost:8091/v1/"), "http://localhost:8091/v1");
  assert.throws(() => validateLoopbackBaseUrl("https://127.0.0.1:8091/v1"), /loopback-only/);
  assert.throws(() => validateLoopbackBaseUrl("http://192.168.1.10:8091/v1"), /loopback-only/);
  assert.throws(() => validateLoopbackBaseUrl("http://127.0.0.1/v1"), /explicit port/);
});

test("voice model evaluation requires absolute private input and ignored runtime output", () => {
  assert.throws(() => resolveEvalPaths({ inputDir: "private-inputs" }), /absolute path/);
  const paths = resolveEvalPaths({ inputDir: "/private/input", runId: "test-run" });
  assert.equal(paths.inputDir, "/private/input");
  assert.match(paths.outputDir, /runtime\/voice-model-evals\/test-run$/);
  assert.throws(
    () => resolveEvalPaths({ inputDir: "/private/input", outputDir: path.resolve("tracked-output") }),
    /ignored runtime directory/,
  );
});

test("voice model evaluation CLI parsing is explicit and deterministic", () => {
  assert.deepEqual(
    parseArgs([
      "--base-url",
      "http://127.0.0.1:8091/v1",
      "--model",
      "default_model",
      "--input-dir",
      "/private/input",
    ]),
    { baseUrl: "http://127.0.0.1:8091/v1", model: "default_model", inputDir: "/private/input" },
  );
  assert.throws(() => parseArgs(["--unknown", "value"]), /Unknown argument/);
});
