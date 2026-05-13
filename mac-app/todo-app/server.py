#!/usr/bin/env python3
"""
osmRouter demo to-do app — runs DIRECTLY on the Mac.

Tunnel chain:
    visitor browser → http://app.todo.localtest.me:8000
        → Docker proxy node (:8000 public)
            → WebSocket tunnel
                → osmrouter-client on this Mac
                    → http://127.0.0.1:3100 (this server)

Plain Python stdlib so no pip/venv is required. Stores todos in memory
(restart wipes them — fine for a demo).
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import socket
import sys
import threading
import time
import uuid

PORT = int(os.environ.get("PORT", "3100"))
HOSTNAME = socket.gethostname()
LOCK = threading.Lock()
TODOS: list[dict] = []


HTML = """<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>osmRouter Demo · To-Do</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #08090b;
  --bg-panel: #0e0f12;
  --bg-soft: #131418;
  --border: #1f2127;
  --border-strong: #2a2d34;
  --text: #f4f4f3;
  --text-muted: #9a9da4;
  --text-faint: #5f6168;
  --accent: oklch(72% 0.16 252);
  --accent-soft: oklch(72% 0.16 252 / 0.14);
  --accent-line: oklch(72% 0.16 252 / 0.35);
  --success: oklch(64% 0.15 152);
  --danger: oklch(60% 0.21 25);
}
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; background: var(--bg); color: var(--text);
  font-family: 'Inter', -apple-system, system-ui, sans-serif; font-size: 14px;
  display: flex; flex-direction: column; align-items: center; padding: 56px 24px 80px;
  -webkit-font-smoothing: antialiased;
}
.shell { max-width: 560px; width: 100%; }
.banner {
  display: flex; align-items: center; gap: 10px;
  background: var(--accent-soft); border: 1px solid var(--accent-line);
  padding: 10px 14px; border-radius: 10px; font-size: 12.5px; color: var(--text-muted); margin-bottom: 28px;
}
.banner .dot { width: 7px; height: 7px; border-radius: 999px; background: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft); animation: pulse 2.4s ease-in-out infinite; }
.banner .meta { font-family: 'JetBrains Mono', monospace; color: var(--text); }
h1 {
  font-size: 32px; font-weight: 600; letter-spacing: -0.025em; margin: 0 0 6px;
}
.sub { color: var(--text-muted); margin: 0 0 28px; font-size: 14.5px; }
.card {
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 14px;
  padding: 22px; box-shadow: 0 1px 0 rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.4);
}
form { display: flex; gap: 8px; margin-bottom: 14px; }
input[type=text] {
  flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
  padding: 10px 12px; color: var(--text); font: inherit; outline: 0;
  transition: all 100ms ease;
}
input[type=text]:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
button.add {
  background: var(--accent); color: white; border: 0; border-radius: 10px;
  padding: 0 16px; font: inherit; font-weight: 600; cursor: pointer; min-width: 80px;
}
button.add:hover { filter: brightness(1.1); }
.list { display: flex; flex-direction: column; gap: 1px; margin: 0; padding: 0; list-style: none; }
.item {
  display: flex; align-items: center; gap: 12px; padding: 12px 4px;
  border-bottom: 1px solid var(--border); transition: background 100ms ease;
}
.item:last-child { border-bottom: 0; }
.item.done .label { text-decoration: line-through; color: var(--text-faint); }
.item input[type=checkbox] {
  appearance: none; width: 18px; height: 18px; border: 1.5px solid var(--border-strong);
  border-radius: 5px; background: var(--bg); cursor: pointer; position: relative;
  transition: all 100ms ease;
}
.item input[type=checkbox]:checked {
  background: var(--accent); border-color: var(--accent);
}
.item input[type=checkbox]:checked::after {
  content: ''; position: absolute; left: 5px; top: 2px; width: 5px; height: 9px;
  border: solid white; border-width: 0 2px 2px 0; transform: rotate(45deg);
}
.label { flex: 1; }
.del {
  background: transparent; border: 0; color: var(--text-faint); cursor: pointer;
  padding: 4px 8px; border-radius: 6px; font-size: 16px; line-height: 1; transition: all 100ms;
}
.del:hover { color: var(--danger); background: rgba(239,68,68,0.08); }
.empty {
  text-align: center; color: var(--text-faint); padding: 28px 0;
  font-style: italic; font-size: 13.5px;
}
.footer {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border);
  font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--text-faint);
}
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
</style>
</head><body>
<div class="shell">
  <div class="banner">
    <span class="dot"></span>
    <span>Served by <span class="meta" id="hostname">…</span> · port <span class="meta">__PORT__</span></span>
  </div>
  <h1>To-Do</h1>
  <p class="sub">A real app running on your Mac, reachable from the public internet through osmRouter.</p>

  <div class="card">
    <form id="addForm" autocomplete="off">
      <input id="newTodo" type="text" placeholder="What needs to be done?" required maxlength="240">
      <button class="add" type="submit">Add</button>
    </form>
    <ul class="list" id="list"></ul>
    <div class="empty" id="empty" hidden>No tasks yet. Add one above.</div>
    <div class="footer">
      <span>Total: <span id="total">0</span> · Done: <span id="done">0</span></span>
      <span id="latency">·</span>
    </div>
  </div>
</div>

<script>
const $list = document.getElementById('list');
const $empty = document.getElementById('empty');
const $total = document.getElementById('total');
const $done = document.getElementById('done');
const $latency = document.getElementById('latency');
const $host = document.getElementById('hostname');

async function api(path, opts) {
  const t0 = performance.now();
  const r = await fetch(path, opts);
  $latency.textContent = (performance.now() - t0).toFixed(0) + ' ms';
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function load() {
  const data = await api('/api/state');
  $host.textContent = data.hostname;
  render(data.todos);
}

function render(todos) {
  $list.innerHTML = '';
  $empty.hidden = todos.length > 0;
  let done = 0;
  for (const t of todos) {
    if (t.done) done++;
    const li = document.createElement('li');
    li.className = 'item' + (t.done ? ' done' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = t.done;
    cb.onchange = () => toggle(t.id);
    const lbl = document.createElement('span');
    lbl.className = 'label';
    lbl.textContent = t.text;
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '×';
    del.title = 'Remove';
    del.onclick = () => remove(t.id);
    li.append(cb, lbl, del);
    $list.appendChild(li);
  }
  $total.textContent = todos.length;
  $done.textContent = done;
}

async function add(text) {
  const data = await api('/api/todos', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({text})
  });
  render(data.todos);
}
async function toggle(id) {
  const data = await api('/api/todos/' + id + '/toggle', { method: 'POST' });
  render(data.todos);
}
async function remove(id) {
  const data = await api('/api/todos/' + id, { method: 'DELETE' });
  render(data.todos);
}

document.getElementById('addForm').onsubmit = (e) => {
  e.preventDefault();
  const input = document.getElementById('newTodo');
  const text = input.value.trim();
  if (!text) return;
  add(text).then(() => { input.value = ''; });
};

load();
</script>
</body></html>
"""


def write_json(handler: BaseHTTPRequestHandler, status: int, body: dict):
    payload = json.dumps(body).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(payload)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(payload)


def state_payload() -> dict:
    return {"hostname": HOSTNAME, "todos": list(TODOS)}


class Handler(BaseHTTPRequestHandler):
    server_version = "osm-todo/1.0"

    def _set_cors(self):
        # Visitor traffic comes via the proxy; CORS isn't strictly needed for
        # same-origin requests, but be tolerant in case someone opens the JSON
        # endpoints directly while testing.
        self.send_header("Access-Control-Allow-Origin", "*")

    def do_GET(self):
        if self.path == "/" or self.path.startswith("/?"):
            body = HTML.replace("__PORT__", str(PORT)).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self._set_cors()
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/api/state":
            with LOCK:
                write_json(self, 200, state_payload())
            return
        if self.path == "/health" or self.path == "/healthz":
            write_json(self, 200, {"ok": True, "ts": time.time(), "hostname": HOSTNAME})
            return
        self.send_error(404)

    def do_POST(self):
        with LOCK:
            if self.path == "/api/todos":
                ln = int(self.headers.get("Content-Length", "0") or "0")
                raw = self.rfile.read(ln).decode("utf-8") if ln else "{}"
                try:
                    data = json.loads(raw or "{}")
                    text = (data.get("text") or "").strip()
                except Exception:
                    text = ""
                if not text:
                    write_json(self, 400, {"error": "text required"})
                    return
                if len(text) > 240:
                    text = text[:240]
                TODOS.append({"id": uuid.uuid4().hex[:8], "text": text, "done": False, "at": time.time()})
                write_json(self, 201, state_payload())
                return
            if self.path.startswith("/api/todos/") and self.path.endswith("/toggle"):
                tid = self.path.split("/")[3]
                for t in TODOS:
                    if t["id"] == tid:
                        t["done"] = not t["done"]
                        write_json(self, 200, state_payload())
                        return
                write_json(self, 404, {"error": "not found"})
                return
            self.send_error(404)

    def do_DELETE(self):
        with LOCK:
            if self.path.startswith("/api/todos/"):
                tid = self.path.split("/")[3]
                before = len(TODOS)
                TODOS[:] = [t for t in TODOS if t["id"] != tid]
                if len(TODOS) == before:
                    write_json(self, 404, {"error": "not found"})
                    return
                write_json(self, 200, state_payload())
                return
            self.send_error(404)

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[todo-app] {self.client_address[0]} {fmt % args}\n")


def main():
    # Seed a couple of todos so the empty state isn't shown in screenshots.
    with LOCK:
        if not TODOS:
            TODOS.extend([
                {"id": uuid.uuid4().hex[:8], "text": "Sign up for osmRouter", "done": True, "at": time.time()},
                {"id": uuid.uuid4().hex[:8], "text": "Bind app.todo.localtest.me to this Mac", "done": True, "at": time.time()},
                {"id": uuid.uuid4().hex[:8], "text": "Open the dashboard at localhost:3030", "done": False, "at": time.time()},
            ])
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    sys.stderr.write(f"[todo-app] listening on http://127.0.0.1:{PORT} (hostname={HOSTNAME})\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("[todo-app] shutting down\n")


if __name__ == "__main__":
    main()
