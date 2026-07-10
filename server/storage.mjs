import fs from "node:fs/promises";
import path from "node:path";

import { defaultWorkspace, normalizeWorkspace } from "./domain.mjs";

export { defaultWorkspace };

export function resolveWorkspaceStore(repoRoot = process.cwd(), stateDir = process.env.PENNY_STATE_DIR || "") {
  const dir = stateDir ? path.resolve(stateDir) : path.join(repoRoot, "runtime", "penny");
  return {
    dir,
    file: path.join(dir, "workspace.json"),
  };
}

export async function readWorkspace(repoRoot = process.cwd(), stateDir = process.env.PENNY_STATE_DIR || "") {
  const store = resolveWorkspaceStore(repoRoot, stateDir);
  try {
    const raw = await fs.readFile(store.file, "utf8");
    return normalizeWorkspace(JSON.parse(raw));
  } catch (error) {
    return defaultWorkspace();
  }
}

export async function writeWorkspace(workspace, repoRoot = process.cwd(), stateDir = process.env.PENNY_STATE_DIR || "") {
  const store = resolveWorkspaceStore(repoRoot, stateDir);
  const normalized = normalizeWorkspace(workspace);
  await fs.mkdir(store.dir, { recursive: true, mode: 0o700 });
  await fs.chmod(store.dir, 0o700);
  const tempFile = path.join(store.dir, `.workspace-${process.pid}-${Date.now()}.tmp`);
  await fs.writeFile(tempFile, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(tempFile, 0o600);
  await fs.rename(tempFile, store.file);
  await fs.chmod(store.file, 0o600);
  return normalized;
}
