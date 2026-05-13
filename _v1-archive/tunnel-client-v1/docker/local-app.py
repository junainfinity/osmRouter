#!/usr/bin/env python3
"""
Tiny HTTP server used as a stand-in for the user's real local app inside
the test container. Replies with a JSON blob identifying its hostname and
the requested path so we can prove the response really came from inside
the container (not the host).
"""
import http.server
import json
import os
import socket
import socketserver
import sys


class Handler(http.server.BaseHTTPRequestHandler):
    def _reply(self):
        payload = {
            "served_by": "in-container local app",
            "hostname":  socket.gethostname(),
            "path":      self.path,
            "method":    self.command,
            "headers":   {k: v for k, v in self.headers.items()},
        }
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload, indent=2).encode())

    def do_GET(self):    self._reply()
    def do_POST(self):   self._reply()
    def do_PUT(self):    self._reply()
    def do_DELETE(self): self._reply()

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[local-app] {fmt % args}\n")


def main():
    port = int(os.environ.get("LOCAL_PORT", "3030"))
    with socketserver.TCPServer(("0.0.0.0", port), Handler) as srv:
        sys.stderr.write(f"[local-app] listening on :{port}\n")
        srv.serve_forever()


if __name__ == "__main__":
    main()
