"""Local dev server: static files + a JSON bridge to the real Python/Qiskit engine.

Run from the repo root:  .venv/bin/python dev/engine_server.py [--port 8000]

The engine keeps module-level session state, so this is a deliberately
single-threaded HTTPServer (never ThreadingHTTPServer) with one persistent
asyncio event loop. Binds to 127.0.0.1 only.
"""

from __future__ import annotations

import argparse
import asyncio
import inspect
import json
import os
import posixpath
import sys
import traceback
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import unquote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
# The engine opens levels/*.json and audio/* with relative literal paths.
os.chdir(ROOT)

from quantum import engine  # noqa: E402

ALLOWED = (
    "load_level", "new_session", "precompute", "apply_gate", "measure",
    "reset_level", "reset_stage", "advance_stage", "snapshot", "load_audio", "run_circuit",
)

MAX_BODY = 64 * 1024
# Static files the game needs; anything else (.git, quantum/, docs/, tests, this file) is a 404.
STATIC_DIRS = ("dev/", "js/", "levels/", "audio/", "assets/")
STATIC_FILES = ("index.html", "main.js", "main.css", "favicon.ico")

ServerClass = HTTPServer
_loop = asyncio.new_event_loop()


def _json(payload):
    return json.dumps(payload, ensure_ascii=False)


def is_static_allowed(url_path):
    """True when a GET path may be served. Decodes and normalises first, so `..` and %2e%2e never escape."""
    decoded = unquote(url_path.split("?", 1)[0].split("#", 1)[0])
    if "\\" in decoded or "\0" in decoded or ".." in decoded.split("/"):
        return False
    rel = posixpath.normpath(decoded).lstrip("/")
    if rel in STATIC_FILES or rel == "dev":
        return True
    if not rel.startswith(STATIC_DIRS):
        return False
    if rel.startswith("dev/"):
        return not rel.startswith("dev/tests/") and not rel.endswith(".py") and "__pycache__" not in rel.split("/")
    return True


def dispatch(fn_name, args):
    """Call engine.<fn_name>(*args); return (http_status, body_text)."""
    if fn_name not in ALLOWED:
        return 404, _json({"error": f"Unknown engine function: {fn_name!r}", "code": "UNKNOWN_FUNCTION"})
    try:
        args = list(args)
        if fn_name == "precompute":
            # window.backend is not serialisable; the server always samples locally.
            args = [None] + args[1:]
        result = getattr(engine, fn_name)(*args)
        if inspect.isawaitable(result):
            result = _loop.run_until_complete(result)
        return 200, result
    except Exception as error:  # noqa: BLE001 - report every failure to the client
        traceback.print_exc()
        return 500, _json({"error": str(error), "code": "SERVER_ERROR"})


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        "": "application/octet-stream",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
        ".html": "text/html",
        ".png": "image/png",
        ".ogg": "audio/ogg",
    }

    timeout = 5  # an idle or half-open connection must not wedge the single-threaded server

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _reply(self, status, text):
        data = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _host_allowed(self):
        """Only localhost:<port> / 127.0.0.1:<port> (blocks DNS rebinding); a missing Host (HTTP/1.0 curl) is fine."""
        host = self.headers.get("Host")
        if host is None:
            return True
        port = self.server.server_address[1]
        return host.strip().lower() in (f"localhost:{port}", f"127.0.0.1:{port}")

    def _guard(self):
        """Reply and return False when the request must not be handled."""
        if self._host_allowed():
            return True
        self._reply(403, _json({"error": "Forbidden host", "code": "FORBIDDEN_HOST"}))
        return False

    def send_head(self):
        if not self._guard():
            return None
        path = self.path.split("?", 1)[0]
        if path == "/":
            self.send_response(302)
            self.send_header("Location", "/dev/")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        if not is_static_allowed(path):
            self.send_error(404, "Not found")
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404, "Not found")
        return None

    def do_POST(self):  # noqa: N802 - http.server naming
        if not self._guard():
            return None
        prefix = "/engine/"
        path = self.path.split("?", 1)[0]
        if not path.startswith(prefix):
            return self._reply(404, _json({"error": "Not found", "code": "NOT_FOUND"}))
        media_type = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        if media_type != "application/json":
            return self._reply(415, _json({"error": "Content-Type must be application/json", "code": "UNSUPPORTED_MEDIA_TYPE"}))
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if not 0 <= length <= MAX_BODY:
                raise ValueError(f"Content-Length must be between 0 and {MAX_BODY}")
            payload = json.loads(self.rfile.read(length) or b"{}")
            args = payload.get("args", [])
            if not isinstance(args, list):
                raise ValueError("args must be a list")
        except (ValueError, AttributeError) as error:
            return self._reply(400, _json({"error": f"Bad request: {error}", "code": "BAD_REQUEST"}))
        status, text = dispatch(path[len(prefix):], args)
        self._reply(status, text)


def make_server(port):
    return ServerClass(("127.0.0.1", port), Handler)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8000)
    options = parser.parse_args(argv)
    httpd = make_server(options.port)
    print(f"Entangled dev server: http://localhost:{httpd.server_address[1]}/dev/", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
