#!/usr/bin/env node
// Hash the built sidecar binary and write resources/sidecar-hash.json.
// Run by `npm run build:sidecar`.

import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESOURCES = path.resolve(__dirname, "..", "resources");

async function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    const s = createReadStream(file);
    s.on("data", (c) => h.update(c));
    s.on("end", () => resolve(h.digest("hex")));
    s.on("error", reject);
  });
}

async function main() {
  const platforms = ["darwin-arm64"]; // v0.1: mac only
  const entries = [];
  for (const p of platforms) {
    const binName = `osm-agent-${p}`;
    const binPath = path.join(RESOURCES, binName);
    try {
      statSync(binPath);
    } catch {
      console.error(`[hash-sidecar] missing: ${binPath} — skipping`);
      continue;
    }
    const hash = await sha256(binPath);
    entries.push({ binary: binName, algo: "sha256", hash, builtAt: new Date().toISOString() });
    console.log(`[hash-sidecar] ${binName} ${hash}`);
  }
  if (!entries.length) {
    console.error("[hash-sidecar] no binaries — exit");
    process.exit(1);
  }
  // For now we only ship one (Mac); the JSON encodes the single entry directly.
  const out = entries[0];
  await writeFile(path.join(RESOURCES, "sidecar-hash.json"), JSON.stringify(out, null, 2));
  console.log(`[hash-sidecar] wrote resources/sidecar-hash.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
