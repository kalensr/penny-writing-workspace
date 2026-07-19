import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const DEFAULT_BASE_URL = "http://127.0.0.1:4177";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BROWSER_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Comet.app/Contents/MacOS/Comet",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

const SMOKE_REPLACEMENT_TEXT = [
  "The selected passage carries the point.",
  "",
  "This added paragraph exists to prove Penny's review surface gives the revision enough room to breathe before the writer decides whether to apply it.",
  "",
  "A cramped preview can hide the actual writing decision, so the browser smoke treats visible reading space as part of the contract.",
].join("\n");
const VOICE_SELECTED_TEXT = "This passage needs voice before the close.";
const VOICE_DRAFT_BODY = `Opening sentence. ${VOICE_SELECTED_TEXT} Closing sentence.`;

function resolveBrowserPath() {
  if (process.env.PENNY_BROWSER_PATH) return process.env.PENNY_BROWSER_PATH;
  const browserPath = DEFAULT_BROWSER_PATHS.find((candidate) => fs.existsSync(candidate));
  if (!browserPath) {
    throw new Error("No supported local Chromium browser found. Set PENNY_BROWSER_PATH.");
  }
  return browserPath;
}

function isCometBrowserPath(browserPath = process.env.PENNY_BROWSER_PATH || "") {
  return browserPath.includes("/Comet.app/");
}

function shouldRunHeadless(browserPath) {
  if (process.env.PENNY_BROWSER_HEADLESS) return process.env.PENNY_BROWSER_HEADLESS !== "0";
  return !isCometBrowserPath(browserPath);
}

async function clickAndWaitForResponse(page, button, predicate) {
  const [response] = await Promise.all([
    page.waitForResponse(predicate, { timeout: 10000 }),
    button.click({ timeout: 10000 }),
  ]);
  return response;
}

async function fetchWorkspace(page) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.waitForLoadState("domcontentloaded");
      return await page.evaluate(async () => {
        const apiPath = new URL("api/workspace", document.baseURI).pathname;
        const response = await fetch(apiPath);
        if (!response.ok) throw new Error(`workspace fetch failed: ${response.status}`);
        return response.json();
      });
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(300);
    }
  }
  throw lastError;
}

async function fetchWithTimeout(url, timeoutMs = 1000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function isReachable(baseUrl) {
  try {
    const response = await fetchWithTimeout(baseUrl, 1000);
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}

async function appShellStatus(baseUrl) {
  try {
    const response = await fetchWithTimeout(baseUrl, 1000);
    const text = await response.text();
    return {
      ok: response.ok && /<html/i.test(text),
      status: response.status,
      text,
    };
  } catch (error) {
    return { ok: false, status: 0, text: error.message };
  }
}

async function resolveDefaultBaseUrl(baseUrl) {
  if (process.env.PENNY_BASE_URL) return baseUrl;
  const rootShell = await appShellStatus(baseUrl);
  if (rootShell.ok) return baseUrl;
  const pennyUrl = `${baseUrl.replace(/\/+$/, "")}/penny/`;
  const pennyShell = await appShellStatus(pennyUrl);
  if (pennyShell.ok) return pennyUrl;
  return baseUrl;
}

function canStartDefaultServer(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    return (
      !process.env.PENNY_BASE_URL &&
      parsed.protocol === "http:" &&
      parsed.hostname === "127.0.0.1" &&
      parsed.port === "4177"
    );
  } catch {
    return false;
  }
}

async function ensurePennyServer(baseUrl) {
  if (await isReachable(baseUrl)) return null;

  if (!canStartDefaultServer(baseUrl)) {
    throw new Error(`Penny browser smoke could not reach ${baseUrl}. Start Penny first or set PENNY_BASE_URL to a reachable server.`);
  }

  const child = spawn(process.execPath, ["server/server.mjs"], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Penny browser smoke server exited before listening.\n${output.trim()}`);
    }
    if (await isReachable(baseUrl)) return child;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  await stopManagedServer(child);
  throw new Error(`Penny browser smoke server did not start within 10s.\n${output.trim()}`);
}

async function stopManagedServer(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const killTimer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 2000);
    child.once("exit", () => {
      clearTimeout(killTimer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function restoreWorkspace(page, workspace) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await page.evaluate(async (savedWorkspace) => {
        const apiPath = new URL("api/workspace", document.baseURI).pathname;
        const response = await fetch(apiPath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(savedWorkspace),
        });
        if (!response.ok) throw new Error(`workspace restore failed: ${response.status}`);
      }, workspace);
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(300);
    }
  }
  throw lastError;
}

async function ensureWritingControlsOpen(page) {
  const drawer = page.locator("details.penny-controls-drawer");
  if ((await drawer.count()) === 0) return;
  const isOpen = await drawer.evaluate((element) => element.open);
  if (!isOpen) {
    await drawer.locator("summary").click();
  }
}

async function main() {
  const baseUrl = await resolveDefaultBaseUrl(process.env.PENNY_BASE_URL || DEFAULT_BASE_URL);
  const managedServer = await ensurePennyServer(baseUrl);
  const browserPath = resolveBrowserPath();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "penny-browser-smoke-"));
  let context;
  let page;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: browserPath,
      headless: shouldRunHeadless(browserPath),
      viewport: { width: 1280, height: 820 },
    });
    page = context.pages()[0] || (await context.newPage());
  } catch (error) {
    if (context) await context.close();
    await stopManagedServer(managedServer);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
  const apiEvents = [];
  const browserEvents = [];
  let originalWorkspace = null;
  let respondCalls = 0;

  page.on("console", (message) => {
    browserEvents.push({ event: "console", type: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => {
    browserEvents.push({ event: "pageerror", text: error.message });
  });
  page.on("request", (request) => {
    if (request.url().includes("/api/")) {
      apiEvents.push({ event: "request", method: request.method(), url: request.url() });
    }
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/")) {
      apiEvents.push({ event: "response", status: response.status(), url: response.url() });
    }
  });

  await page.route("**/api/penny/style-check", async (route) => {
    const body = route.request().postDataJSON();
    const draft = body.selectedText || body.draft || "";
    const aiIndex = draft.indexOf("AI is");
    const mattersIndex = draft.indexOf("This matters");
    const findings = [
      aiIndex >= 0
        ? {
            layer: "CenterOfGravity",
            ruleId: "CenterOfGravity.ToolProtagonist",
            severity: "minor",
            message: "This makes AI or agents the protagonist.",
            fix: "Name the person, team, customer, or organization doing the work.",
            match: "AI is",
            index: aiIndex,
            endIndex: aiIndex + "AI is".length,
          }
        : null,
      mattersIndex >= 0
        ? {
            layer: "DramaticPunctuation",
            ruleId: "DramaticPunctuation.VaguePunchline",
            severity: "minor",
            message: "This short line uses a vague pronoun for drama.",
            fix: "Fold it into a concrete sentence with actor, action, standard, mechanism, or consequence.",
            match: "This matters",
            index: mattersIndex,
            endIndex: mattersIndex + "This matters".length,
          }
        : null,
    ].filter(Boolean);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        calledModel: false,
        report: {
          voiceScore: 92,
          mode: "personal_positioning",
          summary: { status: "strong", label: "strong preservation" },
          detectedSlots: { missing: ["lived_moment", "tension", "reflection", "principle", "service_horizon"] },
          styleFindings: {
            byLayer: {
              CenterOfGravity: findings.filter((finding) => finding.layer === "CenterOfGravity"),
              DramaticPunctuation: findings.filter((finding) => finding.layer === "DramaticPunctuation"),
            },
          },
          violations: findings,
          calibrationNote: "Browser smoke stub.",
        },
      }),
    });
  });

  await page.route("**/api/runtime/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        stdout: JSON.stringify({
          listener: true,
          state: {
            profile: "daily",
            model: "unsloth/gemma-4-26b-a4b-it-UD-MLX-4bit",
          },
        }),
      }),
    });
  });

  await page.route("**/api/penny/respond", async (route) => {
    respondCalls += 1;
    const body = route.request().postDataJSON();
    assert.equal(body.styleProfileId, "executive");
    assert.equal(body.positioningContext?.targetRoleFamily, "technology executive");
    assert.equal(body.positioningContext?.opportunityType, "enterprise platform modernization");
    assert.equal(body.positioningContext?.audience, "retained search partner");
    assert.equal(body.positioningContext?.posture, "relationship-building");
    assert.match(body.positioningContext?.evidenceEmphasis || "", /delivery discipline/);
    assert.match(body.positioningContext?.boundaries || "", /selective remote/);
    if (body.operation === "inline_annotations") {
      assert.match(body.instruction, /Apply the lived moment note only/);
      assert.match(body.instruction, /Prior Penny response/);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          offline: false,
          modeId: body.modeId,
          runtimeProfile: "daily",
          styleProfileId: body.styleProfileId,
          applyMode: "annotate",
          content: "1 inline note ready for review.",
          inlineAnnotations: [
            {
              anchorText: "Redesign your operating model.",
              position: "after",
              note: "[Penny note: Ground this in a lived moment before the command.]",
            },
          ],
          responseStyleReport: {
            voiceScore: 93,
            mode: "leadership_reflection",
            summary: { status: "strong", label: "strong voice match" },
            detectedSlots: { missing: [] },
            violations: [],
            calibrationNote: "Browser smoke stub.",
          },
          sourceStyleReport: {
            voiceScore: 82,
            mode: "leadership_reflection",
            summary: { status: "good", label: "usable voice" },
            detectedSlots: { missing: [] },
            violations: [],
            calibrationNote: "Browser smoke stub.",
          },
        }),
      });
      return;
    }

    if (/cancel smoke request/i.test(body.instruction || "")) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          offline: false,
          modeId: body.modeId,
          runtimeProfile: "daily",
          styleProfileId: body.styleProfileId,
          content: "This response should not replace the cancelled review.",
        }),
      });
      return;
    }

    if (body.operation === "refine_response") {
      assert.match(body.instruction, /Prior Penny response/);
      assert.match(body.instruction, /User follow-up: Make the critique more surgical/);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          offline: false,
          modeId: body.modeId,
          runtimeProfile: "daily",
          styleProfileId: body.styleProfileId,
          content: "Refined clarity pass: keep the operating-model point, but make the next edit a surgical lived-moment insertion.",
          responseStyleReport: {
            voiceScore: 90,
            mode: "leadership_reflection",
            summary: { status: "good", label: "usable voice" },
            detectedSlots: { missing: [] },
            violations: [],
            calibrationNote: "Browser smoke stub.",
          },
        }),
      });
      return;
    }

    if (!body.operation) {
      assert.match(body.instruction, /Make this clearer/i);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          offline: false,
          modeId: body.modeId,
          runtimeProfile: "daily",
          styleProfileId: body.styleProfileId,
          content:
            'Clarity pass: The draft has the right command, but it needs a lived moment before "Redesign your operating model."',
          responseStyleReport: {
            voiceScore: 88,
            mode: "leadership_reflection",
            summary: { status: "good", label: "usable voice" },
            detectedSlots: { missing: [] },
            violations: [],
            calibrationNote: "Browser smoke stub.",
          },
          sourceStyleReport: {
            voiceScore: 78,
            mode: "leadership_reflection",
            summary: { status: "revise", label: "needs revision" },
            detectedSlots: { missing: [] },
            violations: [],
            calibrationNote: "Browser smoke stub.",
          },
        }),
      });
      return;
    }

    assert.equal(body.operation, "voice_revision");
    assert.equal(body.revisionScope, "selection");
    assert.equal(body.selectedText, VOICE_SELECTED_TEXT);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        offline: false,
        modeId: body.modeId,
        runtimeProfile: "daily",
        styleProfileId: body.styleProfileId,
        content: SMOKE_REPLACEMENT_TEXT,
        responseStyleReport: {
          voiceScore: 92,
          mode: "leadership_reflection",
          summary: { status: "strong", label: "strong voice match" },
          detectedSlots: { missing: [] },
          violations: [],
          calibrationNote: "Browser smoke stub.",
        },
        sourceStyleReport: {
          voiceScore: 80,
          mode: "leadership_reflection",
          summary: { status: "revise", label: "needs revision" },
          detectedSlots: { missing: [] },
          violations: [],
          calibrationNote: "Browser smoke stub.",
        },
      }),
    });
  });

  try {
    await page.goto(`${baseUrl.replace(/\/+$/, "")}/?penny_browser_smoke=${Date.now()}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Check voice/i }).waitFor({ timeout: 10000 });
    await page.getByText("Configured model: Gemma 4 26B-A4B: daily writing").waitFor({ timeout: 10000 });
    originalWorkspace = await fetchWorkspace(page);

    const styleProfileSelect = page.locator('select[name="styleProfile"]');
    if ((await styleProfileSelect.inputValue()) !== "executive") {
      const styleSave = page.waitForResponse(
        (response) =>
          response.url().includes("/api/workspace") &&
          response.request().method() === "POST" &&
          response.status() === 200,
        { timeout: 10000 },
      );
      await styleProfileSelect.selectOption("executive");
      await styleSave;
    }
    const contextFields = [
      ['[name="positioning-targetRoleFamily"]', "technology executive"],
      ['[name="positioning-opportunityType"]', "enterprise platform modernization"],
      ['[name="positioning-audience"]', "retained search partner"],
      ['[name="positioning-posture"]', "relationship-building"],
      ['[name="positioning-evidenceEmphasis"]', "delivery discipline and practical AI enablement"],
      ['[name="positioning-boundaries"]', "Midwest, hybrid, or selective remote"],
    ];
    for (const [selector, value] of contextFields) {
      const field = page.locator(selector);
      if ((await field.inputValue()) === value) continue;
      const save = page.waitForResponse(
        (response) =>
          response.url().includes("/api/workspace") &&
          response.request().method() === "POST" &&
          response.status() === 200,
        { timeout: 10000 },
      );
      await field.fill(value);
      await save;
    }

    const initialDraft = "AI is changing review workflows. This matters. The next step is to name the owner before the pilot continues.";
    const initialEditor = page.locator(".document-editor");
    if ((await initialEditor.inputValue()) !== initialDraft) {
      const initialStyleSave = page.waitForResponse(
        (response) =>
          response.url().includes("/api/workspace") &&
          response.request().method() === "POST" &&
          response.status() === 200,
        { timeout: 10000 },
      );
      await initialEditor.fill(initialDraft);
      await initialStyleSave;
    }
    await clickAndWaitForResponse(
      page,
      page.getByRole("button", { name: /Check voice/i }),
      (response) => response.url().includes("/api/penny/style-check") && response.status() === 200,
    );
    await page.waitForSelector(".voice-report", { timeout: 5000 });
    await page.waitForFunction(() => document.body.innerText.includes("Voice check complete."), null, {
      timeout: 5000,
    });
    await page.waitForFunction(() => document.body.innerText.includes("CenterOfGravity"), null, {
      timeout: 5000,
    });
    await page.waitForFunction(() => document.body.innerText.includes("DramaticPunctuation"), null, {
      timeout: 5000,
    });
    await page.locator(".voice-anchor-list button").first().click();
    await page.waitForSelector(".anchor-highlight", { timeout: 5000 });

    const editor = page.locator(".document-editor");
    const annotationTail = `Smoke ${Date.now()}.`;
    const annotationBody = `Redesign your operating model. The team needs a lived moment. ${annotationTail}`;
    const annotationWorkspaceSave = page.waitForResponse(
      (response) =>
        response.url().includes("/api/workspace") &&
        response.request().method() === "POST" &&
        response.status() === 200,
      { timeout: 10000 },
    );
    await editor.fill(annotationBody);
    await annotationWorkspaceSave;
    await ensureWritingControlsOpen(page);
    const instructionBox = page.locator('textarea[name="pennyInstruction"]');
    await instructionBox.waitFor({ state: "visible", timeout: 10000 });
    await instructionBox.fill("Make this clearer and tell me what to improve.");
    await clickAndWaitForResponse(
      page,
      page.getByRole("button", { name: /Ask Penny/i }),
      (response) => response.url().includes("/api/penny/respond") && response.status() === 200,
    );
    await page.waitForFunction(() => document.body.innerText.includes("Clarity pass: The draft has the right command"), null, {
      timeout: 5000,
    });
    await page.waitForSelector(".response-candidates .candidate-card", { timeout: 5000 });
    await page.locator('textarea[name="pennyRefineInstruction"]').fill("Make the critique more surgical.");
    await clickAndWaitForResponse(
      page,
      page.getByRole("button", { name: /^Refine$/i }),
      (response) => response.url().includes("/api/penny/respond") && response.status() === 200,
    );
    await page.waitForFunction(() => document.body.innerText.includes("Refined clarity pass:"), null, {
      timeout: 5000,
    });
    await page.locator(".response-candidates .candidate-restore").nth(1).click();
    await page.waitForFunction(() => document.body.innerText.includes("Clarity pass: The draft has the right command"), null, {
      timeout: 5000,
    });
    await page.locator('textarea[name="inlineAnnotationInstruction"]').fill("Apply the lived moment note only.");
    await clickAndWaitForResponse(
      page,
      page.getByRole("button", { name: /Draft inline notes/i }),
      (response) => response.url().includes("/api/penny/respond") && response.status() === 200,
    );
    await page.waitForFunction(() => document.body.innerText.includes("Inline Notes Preview"), null, {
      timeout: 5000,
    });
    const annotationReviewText = await page.locator(".review-surface").innerText();
    assert.match(annotationReviewText, /Source Penny response/i);
    assert.match(annotationReviewText, /Score 82/);
    assert.doesNotMatch(annotationReviewText, /Score 93/);
    await page.locator(".anchor-preview-button").first().click();
    await page.waitForSelector(".anchor-highlight", { timeout: 5000 });
    const insertInlineNotesButton = page.getByRole("button", { name: /Insert inline notes/i });
    if (isCometBrowserPath(browserPath)) {
      try {
        await insertInlineNotesButton.click({ timeout: 5000 });
      } catch {
        const alreadyInserted = (await editor.inputValue()).includes("[Penny note: Ground this in a lived moment before the command.]");
        if (!alreadyInserted) {
          await insertInlineNotesButton.evaluate((button) => button.click());
        }
      }
    } else {
      await insertInlineNotesButton.click();
    }
    await page.waitForFunction(
      () => document.querySelector(".document-editor")?.value.includes("[Penny note: Ground this in a lived moment before the command.]"),
      null,
      { timeout: 5000 },
    );
    const annotatedDraft = await editor.inputValue();
    assert.equal(
      annotatedDraft,
      `Redesign your operating model. [Penny note: Ground this in a lived moment before the command.] The team needs a lived moment. ${annotationTail}`,
    );
    assert.equal((annotatedDraft.match(/Redesign your operating model\./g) || []).length, 1);
    if (process.env.PENNY_BROWSER_SMOKE_SCOPE === "inline") {
      assert.equal(respondCalls, 2);
      assert.ok(apiEvents.some((event) => event.url.includes("/api/penny/style-check") && event.status === 200));
      console.log("penny_browser_smoke=passed");
      return;
    }

    const voiceWorkspaceSave = page.waitForResponse(
      (response) =>
        response.url().includes("/api/workspace") &&
        response.request().method() === "POST" &&
        response.status() === 200,
      { timeout: 10000 },
    );
    await editor.fill(VOICE_DRAFT_BODY);
    await voiceWorkspaceSave;
    await page.evaluate(() => {
      const textarea = document.querySelector(".document-editor");
      const selectedText = "This passage needs voice before the close.";
      const start = textarea.value.indexOf(selectedText);
      const end = start + selectedText.length;
      textarea.focus();
      textarea.setSelectionRange(start, end);
      const reactPropsKey = Object.keys(textarea).find((key) => key.startsWith("__reactProps$"));
      const reactOnSelect = reactPropsKey ? textarea[reactPropsKey]?.onSelect : null;
      if (typeof reactOnSelect === "function") {
        reactOnSelect({ currentTarget: textarea });
        return;
      }
      textarea.dispatchEvent(new Event("select", { bubbles: true }));
      textarea.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      textarea.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    });
    await page.waitForFunction(() => document.body.innerText.includes("Focused on selected text"), null, {
      timeout: 5000,
    });
    await page.waitForSelector(".selection-popover", { timeout: 5000 });
    await page.locator(".selection-popover button", { hasText: "Ask About This" }).click();
    await page.waitForFunction(
      () => document.querySelector('textarea[name="pennyInstruction"]')?.value.includes("Talk through this selected passage"),
      null,
      { timeout: 5000 },
    );
    await page.evaluate(() => {
      const textarea = document.querySelector(".document-editor");
      textarea.focus();
      textarea.setSelectionRange(0, 0);
      const reactPropsKey = Object.keys(textarea).find((key) => key.startsWith("__reactProps$"));
      const reactOnSelect = reactPropsKey ? textarea[reactPropsKey]?.onSelect : null;
      if (typeof reactOnSelect === "function") {
        reactOnSelect({ currentTarget: textarea });
        return;
      }
      textarea.dispatchEvent(new Event("select", { bubbles: true }));
    });
    await page.waitForFunction(() => document.body.innerText.includes("Using full draft"), null, {
      timeout: 5000,
    });
    await page.evaluate(() => {
      const textarea = document.querySelector(".document-editor");
      const selectedText = "This passage needs voice before the close.";
      const start = textarea.value.indexOf(selectedText);
      const end = start + selectedText.length;
      textarea.focus();
      textarea.setSelectionRange(start, end);
      const reactPropsKey = Object.keys(textarea).find((key) => key.startsWith("__reactProps$"));
      const reactOnSelect = reactPropsKey ? textarea[reactPropsKey]?.onSelect : null;
      if (typeof reactOnSelect === "function") {
        reactOnSelect({ currentTarget: textarea });
        return;
      }
      textarea.dispatchEvent(new Event("select", { bubbles: true }));
    });
    await page.waitForFunction(() => document.body.innerText.includes("Focused on selected text"), null, {
      timeout: 5000,
    });

    await page.locator(".selection-popover button", { hasText: "Revise This" }).click();
    await page.waitForFunction(() => document.body.innerText.includes("Replacement Preview"), null, {
      timeout: 5000,
    });
    await page.waitForFunction(() => document.body.innerText.includes("BEFORE · SELECTED PASSAGE"), null, {
      timeout: 5000,
    });
    await page.waitForFunction(() => document.body.innerText.includes("WORD-LEVEL DIFF"), null, {
      timeout: 5000,
    });
    const revisionOutput = page.locator(".replacement-compare");
    const revisionBox = await revisionOutput.boundingBox();
    assert.ok(revisionBox, "revision output should be visible");
    assert.ok(
      revisionBox.height >= 360,
      `revision output should reserve a readable default height, received ${revisionBox.height}`,
    );
    const openFocusButton = page.getByRole("button", { name: /Open focus view/i });
    await openFocusButton.waitFor({ timeout: 5000 });
    await openFocusButton.click();
    const focusedSurface = page.locator(".review-surface.focused");
    const focusedBox = await focusedSurface.boundingBox();
    assert.ok(focusedBox, "focused review surface should be visible");
    assert.ok(
      focusedBox.height >= 520,
      `focused review surface should use most of the viewport, received ${focusedBox.height}`,
    );
    await page.getByRole("button", { name: /Close focus view/i }).click();
    await page.waitForFunction(() => !document.querySelector(".review-surface.focused"), null, {
      timeout: 5000,
    });
    await ensureWritingControlsOpen(page);
    await page.locator('textarea[name="pennyInstruction"]').fill("Change after preview so this response becomes stale.");
    await page.waitForFunction(() => document.body.innerText.includes("Stale: instruction"), null, {
      timeout: 5000,
    });
    assert.equal(await page.getByRole("button", { name: /Apply in place/i }).isDisabled(), true);
    await page.locator(".selection-popover button", { hasText: "Revise This" }).click();
    await page.waitForFunction(() => document.body.innerText.includes("Replacement Preview"), null, {
      timeout: 5000,
    });
    const applyButton = page.getByRole("button", { name: /Apply in place/i });
    await applyButton.waitFor({ timeout: 10000 });
    try {
      await applyButton.click({ timeout: 5000 });
    } catch {
      await applyButton.evaluate((button) => button.click());
    }
    await page.waitForFunction(
      () => document.querySelector(".document-editor")?.value.includes("The selected passage carries the point."),
      null,
      { timeout: 5000 },
    );

    const finalDraft = await editor.inputValue();
    assert.equal(
      finalDraft,
      `Opening sentence. ${SMOKE_REPLACEMENT_TEXT} Closing sentence.`,
    );
    await page.getByRole("button", { name: /Undo Penny change/i }).click();
    await page.waitForFunction(
      () => document.querySelector(".document-editor")?.value === "Opening sentence. This passage needs voice before the close. Closing sentence.",
      null,
      { timeout: 5000 },
    );
    await ensureWritingControlsOpen(page);
    await page.locator('textarea[name="pennyInstruction"]').fill("cancel smoke request");
    const draftBeforeCancel = await editor.inputValue();
    await page.getByRole("button", { name: /Ask Penny/i }).click();
    await page.locator(".request-progress button", { hasText: "Cancel" }).first().click();
    await page.waitForFunction(() => document.body.innerText.includes("cancelled"), null, {
      timeout: 5000,
    });
    await page.waitForTimeout(1400);
    assert.equal(await editor.inputValue(), draftBeforeCancel);
    assert.ok(respondCalls >= 5);
    assert.ok(apiEvents.some((event) => event.url.includes("/api/penny/style-check") && event.status === 200));
    console.log("penny_browser_smoke=passed");
  } catch (error) {
    console.error("penny_browser_smoke_api_events=", JSON.stringify(apiEvents.slice(-20), null, 2));
    console.error("penny_browser_smoke_browser_events=", JSON.stringify(browserEvents.slice(-20), null, 2));
    try {
      const bodyText = await page.locator("body").innerText({ timeout: 1000 });
      console.error("penny_browser_smoke_body_text=", bodyText.slice(0, 4000));
    } catch (bodyError) {
      console.error("penny_browser_smoke_body_text_error=", bodyError.message);
    }
    throw error;
  } finally {
    try {
      if (originalWorkspace) {
        await restoreWorkspace(page, originalWorkspace);
      }
    } finally {
      await context.close();
      await stopManagedServer(managedServer);
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
