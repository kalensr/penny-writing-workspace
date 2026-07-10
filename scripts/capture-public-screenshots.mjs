import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "docs", "assets");
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penny-public-state-"));
const port = 4191;
const baseUrl = `http://127.0.0.1:${port}`;
const browserPaths = [
  process.env.PENNY_BROWSER_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
].filter(Boolean);
const executablePath = browserPaths.find((candidate) => fs.existsSync(candidate));

if (!executablePath) throw new Error("Set PENNY_BROWSER_PATH to a Chromium browser.");
fs.mkdirSync(assets, { recursive: true });

const server = spawn(process.execPath, ["server/server.mjs", "--port", String(port), "--state-dir", stateDir], {
  cwd: root,
  stdio: "ignore",
});

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Screenshot server did not start.");
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ executablePath, headless: true });
  for (const target of [
    { name: "penny-desktop.png", viewport: { width: 1440, height: 960 } },
    { name: "penny-mobile.png", viewport: { width: 390, height: 844 } },
  ]) {
    const page = await browser.newPage({ viewport: target.viewport });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(assets, target.name), fullPage: true });
    await page.close();
  }
  console.log("public_screenshots=created");
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  fs.rmSync(stateDir, { recursive: true, force: true });
}
