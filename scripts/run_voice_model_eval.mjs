#!/usr/bin/env node

import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PROMPT_ROOT = path.join(REPO_ROOT, "evals", "voice-model", "prompts");

export const VOICE_EVAL_CASES = Object.freeze([
  Object.freeze({
    id: "11-real-voice-preservation",
    promptFile: "11-real-voice-preservation.md",
    inputFile: "journal-voice-preservation-excerpt.md",
    category: "writing",
    maxTokens: 850,
  }),
  Object.freeze({
    id: "12-rough-to-polished",
    promptFile: "12-rough-to-polished-voice.md",
    inputFile: "journal-rough-to-polished-excerpt.md",
    category: "writing",
    maxTokens: 1300,
  }),
  Object.freeze({
    id: "13-polished-style-analysis",
    promptFile: "13-polished-reference-style-analysis.md",
    inputFile: "polished-reference-style-packet.md",
    category: "synthesis",
    maxTokens: 850,
  }),
]);

function usage() {
  return [
    "Usage:",
    "  node scripts/run_voice_model_eval.mjs --base-url URL --model MODEL --input-dir ABSOLUTE_PATH [--output-dir RUNTIME_PATH]",
    "",
    "Raw inputs and outputs remain local-only. Output must stay under this repository's ignored runtime directory.",
  ].join("\n");
}

export function validateLoopbackBaseUrl(value) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Voice evaluation requires a loopback-only HTTP endpoint.");
  }
  if (!url.port) throw new Error("Voice evaluation base URL must include an explicit port.");
  return url.toString().replace(/\/$/, "");
}

export function resolveEvalPaths({ inputDir, outputDir, runId = new Date().toISOString().replace(/[:.]/g, "-") }) {
  if (!path.isAbsolute(String(inputDir || ""))) {
    throw new Error("Private input directory must be an explicit absolute path.");
  }
  const resolvedInput = path.resolve(inputDir);
  const runtimeRoot = path.join(REPO_ROOT, "runtime");
  const resolvedOutput = path.resolve(outputDir || path.join(runtimeRoot, "voice-model-evals", runId));
  const relativeOutput = path.relative(runtimeRoot, resolvedOutput);
  if (!relativeOutput || relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput)) {
    throw new Error("Voice evaluation output must be a new directory under the ignored runtime directory.");
  }
  return { inputDir: resolvedInput, outputDir: resolvedOutput };
}

export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "-h" || key === "--help") return { help: true };
    if (!["--base-url", "--model", "--input-dir", "--output-dir"].includes(key)) {
      throw new Error(`Unknown argument: ${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    options[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  return options;
}

async function requirePrivateInputs(inputDir) {
  const directory = await stat(inputDir);
  if (!directory.isDirectory()) throw new Error("Private input path is not a directory.");
  for (const testCase of VOICE_EVAL_CASES) {
    const inputPath = path.join(inputDir, testCase.inputFile);
    const inputStat = await stat(inputPath);
    if (!inputStat.isFile()) throw new Error(`Required private input is not a file: ${testCase.inputFile}`);
  }
}

function completionContent(body) {
  const message = body?.choices?.[0]?.message || {};
  return message.content || message.reasoning_content || message.reasoning || message.text || "";
}

async function writePrivateFile(filePath, contents) {
  await writeFile(filePath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function runCase({ baseUrl, model, inputDir, outputDir, testCase, fetchImpl = fetch }) {
  const [prompt, source] = await Promise.all([
    readFile(path.join(PROMPT_ROOT, testCase.promptFile), "utf8"),
    readFile(path.join(inputDir, testCase.inputFile), "utf8"),
  ]);
  const payload = {
    model,
    messages: [{ role: "user", content: `${prompt.trim()}\n\n## Source Input\n\n${source}` }],
    temperature: 0.4,
    top_p: 0.9,
    max_tokens: testCase.maxTokens,
    stream: false,
  };
  const started = performance.now();
  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(600_000),
  });
  const body = await response.json();
  const elapsedSeconds = Number(((performance.now() - started) / 1000).toFixed(3));
  if (!response.ok) throw new Error(`Voice evaluation request failed for ${testCase.id} with HTTP ${response.status}.`);
  const content = completionContent(body).trim();
  if (!content) throw new Error(`Voice evaluation returned empty content for ${testCase.id}.`);
  const outputPath = path.join(outputDir, `${testCase.id}.md`);
  await writePrivateFile(outputPath, `${content}\n`);
  await writePrivateFile(`${outputPath}.response.json`, `${JSON.stringify(body, null, 2)}\n`);
  const completionTokens = body.usage?.completion_tokens ?? null;
  return {
    id: testCase.id,
    category: testCase.category,
    finishReason: body.choices?.[0]?.finish_reason ?? null,
    promptTokens: body.usage?.prompt_tokens ?? null,
    completionTokens,
    elapsedSeconds,
    tokensPerSecond: completionTokens ? Number((completionTokens / elapsedSeconds).toFixed(2)) : null,
    outputFile: path.relative(REPO_ROOT, outputPath),
  };
}

export async function runVoiceModelEval(options, dependencies = {}) {
  const baseUrl = validateLoopbackBaseUrl(options.baseUrl);
  if (!String(options.model || "").trim()) throw new Error("Voice evaluation requires an explicit model name.");
  const paths = resolveEvalPaths(options);
  await requirePrivateInputs(paths.inputDir);
  await mkdir(path.dirname(paths.outputDir), { recursive: true, mode: 0o700 });
  await mkdir(paths.outputDir, { recursive: false, mode: 0o700 });
  await chmod(paths.outputDir, 0o700);
  const results = [];
  for (const testCase of VOICE_EVAL_CASES) {
    const result = await runCase({
      baseUrl,
      model: options.model,
      inputDir: paths.inputDir,
      outputDir: paths.outputDir,
      testCase,
      fetchImpl: dependencies.fetchImpl,
    });
    results.push(result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
  const receipt = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    model: options.model,
    baseUrl,
    generation: { temperature: 0.4, topP: 0.9 },
    results,
  };
  await writePrivateFile(path.join(paths.outputDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.baseUrl || !options.model || !options.inputDir) throw new Error(usage());
  await runVoiceModelEval(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`voice_model_eval.error=${error.message}\n`);
    process.exitCode = 1;
  });
}
