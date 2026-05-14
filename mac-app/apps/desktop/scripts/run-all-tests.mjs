#!/usr/bin/env node
// Convenience: print a short summary after running the whole TS suite.
import { spawn } from "node:child_process";
const child = spawn("npx", ["vitest", "run"], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
