"""
WebSocket broadcaster: pushes detection state to Three.js simulator.
Runs a small ws server in a background thread.
"""

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer


class SimBroadcaster:
    def __init__(self, port=8765):
        self.port = port
        self.clients = set()
        self._state = {}
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self):
        # Minimal ws via stdlib http + manual upgrade (or use websockets lib).
        # For dev only: use python -m http.server for sim/ and skip ws.
        # State is read by sim directly via /state.json polling.
        from http.server import BaseHTTPRequestHandler
        import socketserver

        broadcaster = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a, **k):
                pass

            def do_GET(self):
                if self.path == "/state.json":
                    body = json.dumps(broadcaster._state).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                else:
                    self.send_response(404)
                    self.end_headers()

        with socketserver.TCPServer(("0.0.0.0", self.port), H) as srv:
            self._server = srv
            srv.serve_forever()

    def broadcast(self, data: dict) -> None:
        # Stash latest; sim polls /state.json
        # (no in-memory list needed for dev sim)
        self._state = data

    def close(self):
        try:
            self._server.shutdown()
        except Exception:
            pass
