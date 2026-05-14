#!/usr/bin/env node
// Test-only fake sidecar. Reads CLI flags, emits the JSON protocol the
// Main process expects, and behaves deterministically:
//   --mode=ready           emit ready, telemetry x3, then idle
//   --mode=heartbeat-only  emit one heartbeat then sleep until SIGTERM
//   --mode=crash           emit ready, then exit(1) after 200ms
//   --mode=no-heartbeat    emit ready and stay silent (triggers watchdog SIGKILL)
//   --mode=respond         emit ready and a synthetic request event
import process from "node:process";

function emit(o) {
  process.stdout.write(JSON.stringify(o) + "\n");
}

const args = process.argv.slice(2);
const flag = (n, dflt) => {
  // accept both "--n=value" and "--n value"
  for (const a of args) {
    if (a.startsWith(`--${n}=`)) return a.slice(n.length + 3);
  }
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const mode = flag("mode", "ready");

let alive = true;
process.on("SIGTERM", () => {
  emit({ event: "log", level: "info", msg: "fake:sigterm-received" });
  alive = false;
  process.exit(0);
});

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  emit({ event: "log", level: "info", msg: `fake:boot mode=${mode}` });

  if (mode === "no-heartbeat") {
    emit({ event: "ready" });
    while (alive) await sleep(1000); // no heartbeats; watchdog should kill us
    return;
  }

  if (mode === "crash") {
    emit({ event: "ready" });
    await sleep(200);
    process.exit(1);
  }

  emit({ event: "ready" });
  // Send 1 heartbeat immediately so manager records lastHeartbeat
  emit({ event: "heartbeat", t: Date.now() });

  if (mode === "respond") {
    await sleep(50);
    emit({ event: "request", method: "GET", path: "/", status: 200, latencyMs: 12, sizeBytes: 1024, remote: "1.2.3.4" });
  }

  if (mode === "heartbeat-only") {
    const hb = setInterval(() => emit({ event: "heartbeat", t: Date.now() }), 200);
    while (alive) await sleep(500);
    clearInterval(hb);
    return;
  }

  // default: ready + 3 telemetry ticks at 100ms apart
  for (let i = 0; i < 3 && alive; i++) {
    await sleep(100);
    emit({ event: "telemetry", inbound: 1024 * (i + 1), outbound: 512, latencyMs: 10 + i, activeConns: i });
    emit({ event: "heartbeat", t: Date.now() });
  }
  emit({ event: "log", level: "info", msg: "fake:done" });
})().catch((e) => {
  emit({ event: "error", message: String(e) });
  process.exit(2);
});
