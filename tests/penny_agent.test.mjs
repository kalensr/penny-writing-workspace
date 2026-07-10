import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  askPenny,
  buildChatCompletionPayload,
  cleanPennyText,
  parseInlineAnnotations,
  resolveModelClientConfig,
} from "../server/penny_agent.mjs";
import {
  buildPennyMessages,
  getPennyMode,
  listPennyModes,
} from "../server/prompt_contract.mjs";
import {
  assertLoopbackModelBaseUrl,
  mapRuntimeAction,
  parseRuntimeStatusModel,
} from "../server/runtime_adapter.mjs";
import {
  defaultWorkspace,
  resolveWorkspaceStore,
} from "../server/storage.mjs";

test("Penny exposes practical writing collaboration modes", () => {
  const modes = listPennyModes();
  const ids = modes.map((mode) => mode.id);

  assert.deepEqual(ids, [
    "draft_from_notes",
    "revise_clarity",
    "preserve_voice",
    "critique",
    "expand",
    "compress",
    "outline",
    "title_lede",
    "quality_review",
  ]);
  assert.equal(getPennyMode("quality_review").runtimeProfile, "quality");
  assert.equal(getPennyMode("revise_clarity").runtimeProfile, "daily");
});

test("Penny prompt contract preserves the draft and selected mode", () => {
  const messages = buildPennyMessages({
    modeId: "preserve_voice",
    writingType: "executive memo",
    documentTitle: "Quarterly AI Adoption Memo",
    draft: "This is the current draft.",
    selectedText: "current draft",
    instruction: "Make it sound more like me.",
  });

  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /You are Penny/);
  assert.match(messages[0].content, /local-first writing collaborator/);
  assert.match(messages[0].content, /plain text only/i);
  assert.match(messages[0].content, /no Markdown/i);
  assert.equal(messages[1].role, "user");
  assert.match(messages[1].content, /Mode: Preserve voice/);
  assert.match(messages[1].content, /Writing type: executive memo/);
  assert.match(messages[1].content, /Selected text:\ncurrent draft/);
  assert.match(messages[1].content, /Full draft:\nThis is the current draft\./);
});

test("Penny prompt contract includes deterministic voice report context", () => {
  const payload = buildChatCompletionPayload({
    modeId: "preserve_voice",
    writingType: "leadership reflection",
    documentTitle: "A Leadership Reflection",
    draft: "In today's rapidly evolving landscape, leaders must leverage alignment.",
    instruction: "Make this sound more like me.",
    styleProfileId: "reflective",
  });

  assert.match(payload.messages[1].content, /Deterministic Penny style report/);
  assert.match(payload.messages[1].content, /Voice score:/);
  assert.match(payload.messages[1].content, /Top issues:/);
  assert.match(payload.messages[1].content, /Voice\.GenericOpening/);
});

test("Penny prompt contract includes contextual personal-positioning guidance without fixed copy", () => {
  const messages = buildPennyMessages({
    modeId: "critique",
    writingType: "recruiter-facing cover letter",
    documentTitle: "Executive Search Note",
    draft: "I am interested in senior technology leadership roles.",
    instruction: "Review for positioning.",
    styleProfileId: "executive",
    positioningContext: {
      targetRoleFamily: "technology executive",
      opportunityType: "enterprise platform modernization",
      audience: "retained search partner",
      posture: "relationship-building",
      evidenceEmphasis: "delivery discipline and practical AI enablement",
      boundaries: "Midwest, hybrid, or selective remote",
    },
  });

  assert.match(messages[1].content, /Positioning context:/);
  assert.match(messages[1].content, /Target role family: technology executive/);
  assert.match(messages[1].content, /Opportunity type: enterprise platform modernization/);
  assert.match(messages[1].content, /Do not force a fixed recruiter-facing formula/);
  assert.doesNotMatch(messages[1].content, /Chief Technology Officer, Vice President/);
});

test("Penny gives the quality specialist a longer output budget", () => {
  const payload = buildChatCompletionPayload({
    modeId: "quality_review",
    writingType: "long-form essay",
    documentTitle: "Long Draft",
    draft: "This is a longer draft that needs a deliberate quality pass.",
    instruction: "Give me a deeper second-reader pass.",
    styleProfileId: "executive",
  });

  assert.equal(payload.max_tokens, 1300);
});

test("Penny chat payload can request an in-place voice revision", () => {
  const payload = buildChatCompletionPayload({
    modeId: "preserve_voice",
    operation: "voice_revision",
    revisionScope: "selection",
    writingType: "leadership reflection",
    documentTitle: "A Leadership Reflection",
    draft: "Opening sentence. This middle needs voice. Closing sentence.",
    selectedText: "This middle needs voice.",
    instruction: "Use the voice report to revise the selected passage in place.",
    styleProfileId: "reflective",
  });

  assert.match(payload.messages[1].content, /Operation: Voice revision/);
  assert.match(payload.messages[1].content, /Revision scope: selection/);
  assert.match(payload.messages[1].content, /Return only replacement text/);
});

test("Penny chat payload can request additive inline annotations", () => {
  const payload = buildChatCompletionPayload({
    modeId: "critique",
    operation: "inline_annotations",
    writingType: "blog post",
    documentTitle: "Agentic Operating Model",
    draft: "Redesign your operating model. The team needs a lived moment.",
    instruction: "Apply the first critique as inline guidance only.",
    styleProfileId: "reflective",
  });

  assert.match(payload.messages[1].content, /Operation: Inline annotations/);
  assert.match(payload.messages[1].content, /Return a JSON array only/);
  assert.match(payload.messages[1].content, /Do not rewrite, delete, or reorder existing draft text/);
  assert.match(payload.messages[1].content, /\[Penny note:/);
});

test("Penny parses raw structured inline annotations from model output", () => {
  const annotations = parseInlineAnnotations(
    '[{"anchorText":"Redesign your operating model.","position":"after","note":"Add a lived moment here."}]',
  );

  assert.deepEqual(annotations, [
    {
      anchorText: "Redesign your operating model.",
      position: "after",
      note: "[Penny note: Add a lived moment here.]",
    },
  ]);
});

test("Penny rejects invalid or wrapped inline annotation payloads", () => {
  assert.throws(
    () => parseInlineAnnotations('[{"anchorText":"","position":"during","note":""}]'),
    /valid inline annotations/,
  );
  assert.throws(
    () =>
      parseInlineAnnotations([
        "Here are the notes:",
        "```json",
        '[{"anchorText":"Redesign your operating model.","position":"after","note":"Add detail."}]',
        "```",
      ].join("\n")),
    /valid inline annotations/,
  );
});

test("Penny response includes parsed inline annotations for annotation operation", async () => {
  const result = await askPenny(
    {
      modeId: "critique",
      operation: "inline_annotations",
      writingType: "blog post",
      documentTitle: "Agentic Operating Model",
      draft: "Redesign your operating model. The team needs a lived moment.",
      instruction: "Apply the critique as inline guidance.",
      styleProfileId: "reflective",
    },
    {
      modelBaseUrl: "http://127.0.0.1:8091/v1",
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content:
                  '[{"anchorText":"Redesign your operating model.","position":"after","note":"[Penny note: Ground this in a lived moment before the command.]"}]',
              },
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 18 },
        }),
      }),
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.applyMode, "annotate");
  assert.equal(result.inlineAnnotations.length, 1);
  assert.match(result.content, /1 inline note ready/);
  assert.equal(result.responseStyleReport, undefined);
});

test("Penny reports invalid inline annotation JSON as a contract error, not a runtime outage", async () => {
  const result = await askPenny(
    {
      modeId: "critique",
      operation: "inline_annotations",
      writingType: "blog post",
      documentTitle: "Agentic Operating Model",
      draft: "Redesign your operating model.",
      instruction: "Apply the critique as inline guidance.",
      styleProfileId: "reflective",
    },
    {
      modelBaseUrl: "http://127.0.0.1:8091/v1",
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Here are some inline notes, but not JSON." } }],
          usage: { prompt_tokens: 12, completion_tokens: 18 },
        }),
      }),
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.offline, false);
  assert.equal(result.contractError, true);
  assert.match(result.content, /reached the local model/);
  assert.doesNotMatch(result.content, /cannot reach the local writing model/i);
});

test("Penny prompt contract preserves raw journal structure policy", () => {
  const messages = buildPennyMessages({
    modeId: "preserve_voice",
    writingType: "journal",
    documentTitle: "Morning Notes",
    draft: "- [ ] Pray through the decision",
    instruction: "Keep this raw.",
    styleProfileId: "raw-journal",
  });

  assert.match(messages[0].content, /Preserve raw journal structure/);
  assert.match(messages[0].content, /task markers/);
  assert.match(messages[1].content, /Raw journal/);
  assert.doesNotMatch(messages[1].content, /plain text only, with no Markdown syntax/);
});

test("Penny cleans Markdown noise before showing or inserting text", () => {
  const messy = [
    "***",
    "# Agentic Operating Model: From Personal Throughput to Institutional Advantage",
    "",
    "## Executive Summary",
    "The goal is to optimize for **decision quality per unit of human attention**, rather than sheer activity volume.",
    "",
    "### The Strategic Shift",
    '* **From:** "How can I do more?" $\\rightarrow$ **To:** "What should only I do?"',
    "> This memo outlines the practical operating shift.",
    "##",
  ].join("\n");

  const cleaned = cleanPennyText(messy);

  assert.equal(
    cleaned,
    [
      "Agentic Operating Model: From Personal Throughput to Institutional Advantage",
      "",
      "Executive Summary",
      "The goal is to optimize for decision quality per unit of human attention, rather than sheer activity volume.",
      "",
      "The Strategic Shift",
      '- From: "How can I do more?" -> To: "What should only I do?"',
      "This memo outlines the practical operating shift.",
    ].join("\n"),
  );
  assert.doesNotMatch(cleaned, /(^|\n)#{1,6}\s/);
  assert.doesNotMatch(cleaned, /\*\*/);
  assert.doesNotMatch(cleaned, /\$\\rightarrow\$/);
  assert.doesNotMatch(cleaned, /^>/m);
});

test("Penny can preserve Markdown-like journal markers in raw journal mode", () => {
  const cleaned = cleanPennyText("## Morning notes\n- [ ] Pray through this \u2014 then choose.", {
    voiceMode: "raw_journal",
  });

  assert.equal(cleaned, "## Morning notes\n- [ ] Pray through this, then choose.");
});

test("Penny chat payload targets the MLX server default model", () => {
  const payload = buildChatCompletionPayload({
    modeId: "revise_clarity",
    model: "mlx-community/gemma-4-26B-A4B-it-qat-OptiQ-4bit",
    draft: "This needs clarity.",
    instruction: "Tighten it.",
  });

  assert.equal(payload.model, "default_model");
});

test("Penny chat payload defaults to MLX default model", () => {
  const payload = buildChatCompletionPayload({
    modeId: "revise_clarity",
    draft: "This needs clarity.",
    instruction: "Tighten it.",
  });

  assert.equal(payload.model, "default_model");
});

test("Penny response returns source and response style reports", async () => {
  const result = await askPenny(
    {
      modeId: "preserve_voice",
      writingType: "leadership reflection",
      documentTitle: "Reflection",
      draft: "I wonder what the next step should be. I need a plan.",
      instruction: "Preserve my voice.",
      styleProfileId: "reflective",
    },
    {
      modelBaseUrl: "http://127.0.0.1:8091/v1",
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content:
                  "I was sitting with the question again. The next step is to turn the pressure into a plan and keep the work tied to service.",
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      }),
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.styleProfileId, "reflective");
  assert.equal(result.sourceStyleReport.mode, "reflective");
  assert.equal(result.responseStyleReport.mode, "reflective");
  assert.match(result.content, /The next step/);
});

test("Penny parses the running model from writing runtime status", () => {
  const result = {
    ok: true,
    stdout: JSON.stringify({
      listener: true,
      state: {
        model: "mlx-community/gemma-4-26B-A4B-it-qat-OptiQ-4bit",
      },
    }),
  };

  assert.equal(
    parseRuntimeStatusModel(result),
    "mlx-community/gemma-4-26B-A4B-it-qat-OptiQ-4bit",
  );
  assert.equal(parseRuntimeStatusModel({ ok: false, stdout: "" }), null);
});

test("Penny runtime actions are allowlisted and deterministic", () => {
  assert.deepEqual(mapRuntimeAction({ action: "start_daily" }), ["on"]);
  assert.deepEqual(mapRuntimeAction({ action: "stop" }), ["off"]);
  assert.deepEqual(mapRuntimeAction({ action: "smoke" }), ["smoke"]);
  assert.deepEqual(mapRuntimeAction({ action: "swap", profile: "quality" }), ["swap", "quality"]);
  assert.deepEqual(mapRuntimeAction({ action: "swap", profile: "daily" }), ["swap", "daily"]);

  assert.throws(
    () => mapRuntimeAction({ action: "swap", profile: "experimental" }),
    /Unsupported runtime profile/,
  );
  assert.throws(
    () => mapRuntimeAction({ action: "shell", command: "launchctl list" }),
    /Unsupported runtime action/,
  );
});

test("Penny model endpoint must remain loopback", () => {
  assert.equal(
    assertLoopbackModelBaseUrl("http://127.0.0.1:8091/v1"),
    "http://127.0.0.1:8091/v1",
  );
  assert.throws(
    () => assertLoopbackModelBaseUrl("http://0.0.0.0:8091/v1"),
    /loopback/,
  );
  assert.throws(
    () => assertLoopbackModelBaseUrl("https://example.com/v1"),
    /loopback/,
  );
});

test("shared model mode uses the stable alias and a credential file", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "penny-config-token-"));
  const tokenFile = path.join(directory, "queue-token");
  await fs.writeFile(tokenFile, "queue-secret\n", { mode: 0o600 });
  const config = resolveModelClientConfig({
    modelMode: "shared",
    modelBaseUrl: "http://127.0.0.1:8092/v1",
    credentialFile: tokenFile,
  });
  assert.equal(config.model, "penny-writing");
  assert.equal(config.timeoutMs, 420000);
  assert.equal(await config.authorization(), "Bearer queue-secret");
  assert.throws(
    () => resolveModelClientConfig({ modelMode: "shared", credential: "inline-secret" }),
    /credential file/i,
  );
  assert.throws(
    () => resolveModelClientConfig({ modelMode: "shared", credentialFile: "relative-token" }),
    /absolute path/i,
  );
});

test("shared model credentials are opened without following symlinks and require owner 0600", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "penny-credential-"));
  const credential = path.join(directory, "queue-token");
  const symlink = path.join(directory, "queue-token-link");
  await fs.writeFile(credential, "secret\n", { mode: 0o600 });
  const secure = resolveModelClientConfig({ modelMode: "shared", credentialFile: credential });
  assert.equal(await secure.authorization(), "Bearer secret");

  await fs.chmod(credential, 0o640);
  await assert.rejects(secure.authorization(), /credential file is unavailable or unsafe/i);
  await fs.chmod(credential, 0o600);
  await fs.symlink(credential, symlink);
  const linked = resolveModelClientConfig({ modelMode: "shared", credentialFile: symlink });
  await assert.rejects(linked.authorization(), /credential file is unavailable or unsafe/i);
});

test("model timeout rejects zero and non-finite values", () => {
  for (const timeoutMs of [0, Infinity, -1, Number.NaN]) {
    assert.throws(
      () => resolveModelClientConfig({ modelMode: "local", timeoutMs }),
      /positive integer/i,
    );
  }
});

test("shared model requests authenticate and report the model actually used", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "penny-request-token-"));
  const tokenFile = path.join(directory, "queue-token");
  await fs.writeFile(tokenFile, "secret-token\n", { mode: 0o600 });
  let captured;
  const result = await askPenny(
    { modeId: "revise_clarity", draft: "Draft.", instruction: "Revise." },
    {
      modelMode: "shared",
      modelBaseUrl: "http://127.0.0.1:8092/v1",
      credentialFile: tokenFile,
      fetchImpl: async (_url, options) => {
        captured = options;
        return {
          ok: true,
          json: async () => ({
            model: "gemma-runtime-26b",
            choices: [{ message: { content: "Revised draft." } }],
            usage: { prompt_tokens: 2, completion_tokens: 3 },
          }),
        };
      },
    },
  );

  assert.equal(JSON.parse(captured.body).model, "penny-writing");
  assert.equal(captured.headers.authorization, "Bearer secret-token");
  assert.equal(result.requestedModel, "penny-writing");
  assert.equal(result.actualModel, "gemma-runtime-26b");
});

test("shared model failures distinguish queue, service, wait, generation, and connection errors", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "penny-failure-token-"));
  const tokenFile = path.join(directory, "queue-token");
  await fs.writeFile(tokenFile, "secret\n", { mode: 0o600 });
  const request = { modeId: "revise_clarity", draft: "Draft.", instruction: "Revise." };
  const shared = {
    modelMode: "shared",
    credentialFile: tokenFile,
  };
  const statusResult = async (status) => askPenny(request, {
    ...shared,
    fetchImpl: async () => ({ ok: false, status }),
  });

  assert.equal((await statusResult(429)).errorKind, "queue_wait");
  assert.equal((await statusResult(503)).errorKind, "service_unavailable");
  assert.equal((await statusResult(500)).errorKind, "generation");
  assert.equal((await askPenny(request, {
    ...shared,
    fetchImpl: async () => ({
      ok: false,
      status: 504,
      json: async () => ({ error: "queue_wait_timeout" }),
    }),
  })).errorKind, "wait_timeout");
  assert.equal((await askPenny(request, {
    ...shared,
    fetchImpl: async () => ({
      ok: false,
      status: 504,
      json: async () => ({ error: "generation_timeout" }),
    }),
  })).errorKind, "generation");
  assert.equal((await askPenny(request, {
    ...shared,
    fetchImpl: async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); },
  })).errorKind, "wait_timeout");
  assert.equal((await askPenny(request, {
    ...shared,
    fetchImpl: async () => { throw new TypeError("fetch failed"); },
  })).errorKind, "connection");
});

test("Penny workspace storage is under ignored runtime directory", () => {
  const store = resolveWorkspaceStore("/repo");

  assert.equal(store.dir, "/repo/runtime/penny");
  assert.equal(store.file, "/repo/runtime/penny/workspace.json");
  assert.equal(defaultWorkspace().projects[0].documents[0].title, "Quarterly AI Adoption Memo");
});

test("Penny workspace storage can use an explicit private state directory", () => {
  const store = resolveWorkspaceStore("/repo", "/private/penny-state");

  assert.equal(store.dir, "/private/penny-state");
  assert.equal(store.file, "/private/penny-state/workspace.json");
});
