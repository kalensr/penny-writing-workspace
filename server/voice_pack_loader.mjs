import fs from "node:fs";
import path from "node:path";

import { DEFAULT_VOICE_PACK, createVoicePackRegistry } from "./voice_pack_schema.mjs";

export function loadVoicePackConfiguration({ packDir = process.env.PENNY_VOICE_PACK_DIR || "" } = {}) {
  const warnings = [];
  const packs = [DEFAULT_VOICE_PACK];
  const normalizedPackDir = String(packDir || "").trim();

  if (normalizedPackDir) {
    const resolvedPackDir = path.resolve(normalizedPackDir);
    if (!fs.existsSync(resolvedPackDir)) {
      warnings.push("Configured voice pack directory was not found; Penny is using built-in profiles.");
    } else if (!fs.statSync(resolvedPackDir).isDirectory()) {
      throw new Error(`Voice pack path must be a directory: ${resolvedPackDir}`);
    } else {
      const files = fs.readdirSync(resolvedPackDir).filter((file) => file.endsWith(".json")).sort();
      if (files.length === 0) warnings.push("Configured voice pack directory contains no JSON packs; Penny is using built-in profiles.");
      for (const file of files) {
        packs.push(JSON.parse(fs.readFileSync(path.join(resolvedPackDir, file), "utf8")));
      }
    }
  }

  return { ...createVoicePackRegistry(packs), warnings };
}
