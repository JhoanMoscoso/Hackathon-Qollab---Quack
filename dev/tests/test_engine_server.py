import json
import threading
import urllib.error
import urllib.request
from http.server import HTTPServer

import pytest

from dev import engine_server
from quantum import engine


def body(result):
    status, text = result
    return status, json.loads(text)


def test_unknown_function_is_rejected():
    status, payload = body(engine_server.dispatch("os_system", ["ls"]))
    assert status == 404
    assert payload["code"] == "UNKNOWN_FUNCTION"
    assert "error" in payload


def test_private_and_non_allowlisted_names_are_rejected():
    for name in ("_engine", "Engine", "encode", "__class__", ""):
        status, payload = body(engine_server.dispatch(name, []))
        assert status == 404 and payload["code"] == "UNKNOWN_FUNCTION"


def test_new_session_level1_starts_at_00():
    status, text = engine_server.dispatch("new_session", ["level1"])
    assert status == 200
    snap = json.loads(text)
    assert "error" not in snap
    assert "|00⟩" in text  # verbatim engine JSON, ensure_ascii=False


def test_coroutine_load_level_is_awaited():
    status, text = engine_server.dispatch("load_level", ["level1"])
    assert status == 200
    # a bare coroutine would not be JSON-serialisable / would not be a str
    assert isinstance(json.loads(text), dict)


def test_run_circuit_before_building_reports_incomplete():
    engine_server.dispatch("load_level", ["level1"])
    engine_server.dispatch("new_session", ["level1"])
    status, payload = body(engine_server.dispatch("run_circuit", []))
    assert status == 200
    assert payload["code"] == "CIRCUIT_INCOMPLETE"


def test_phi_plus_measurement_through_the_dev_server_is_not_a_fixed_outcome():
    """User report: after H, CX, RUN the first outcome was always 00. Through dispatch (precompute + new_session
    + gates + run + measure) both outcomes must appear, in a mix that is not stuck on either value."""
    engine_server.dispatch("precompute", [None, 200])
    outcomes = []
    for _ in range(120):
        engine_server.dispatch("new_session", ["level1"])
        engine_server.dispatch("apply_gate", ["h", 0, -1, None, "alice"])
        engine_server.dispatch("apply_gate", ["cx", 0, 1, None, "bob"])
        engine_server.dispatch("run_circuit", [])
        status, payload = body(engine_server.dispatch("measure", [0]))
        assert status == 200 and "error" not in payload
        outcomes.append(payload["outcome"])
    assert 0.25 < sum(outcomes) / len(outcomes) < 0.75, outcomes
    assert len(set(outcomes)) == 2


def test_precompute_backend_argument_is_replaced_with_none(monkeypatch):
    seen = []

    async def fake_precompute(backend=None, shots=200, strategy="packed"):
        seen.append((backend, shots, strategy))
        return json.dumps({"ok": True})

    monkeypatch.setattr(engine, "precompute", fake_precompute)
    status, text = engine_server.dispatch("precompute", [{"evil": 1}, 50])
    assert status == 200 and json.loads(text) == {"ok": True}
    assert seen == [(None, 50, "packed")]
    engine_server.dispatch("precompute", [])
    assert seen[-1][0] is None


def test_python_exception_becomes_500(monkeypatch):
    def boom():
        raise RuntimeError("kaput")

    monkeypatch.setattr(engine, "snapshot", boom)
    status, payload = body(engine_server.dispatch("snapshot", []))
    assert status == 500
    assert payload == {"error": "kaput", "code": "SERVER_ERROR"}


def test_bad_args_type_is_server_error():
    status, payload = body(engine_server.dispatch("new_session", [1, 2, 3]))
    assert status == 500 and payload["code"] == "SERVER_ERROR"


@pytest.fixture
def server():
    httpd = engine_server.make_server(0)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    httpd.server_close()


def fetch(url, data=None, headers=None):
    hdrs = {"Content-Type": "application/json"} if data is not None else {}
    hdrs.update(headers or {})
    request = urllib.request.Request(url, data=data, method="POST" if data is not None else "GET", headers=hdrs)
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read()


def test_server_is_a_single_threaded_http_server(server):
    assert issubclass(engine_server.ServerClass, HTTPServer)
    assert engine_server.ServerClass.__name__ == "HTTPServer"


def test_http_post_engine_new_session(server):
    status, headers, data = fetch(server + "/engine/new_session", b'{"args":["level1"]}')
    assert status == 200
    assert headers["Content-Type"].startswith("application/json")
    assert "|00⟩" in data.decode("utf-8")


def test_http_unknown_function_is_404_json(server):
    status, headers, data = fetch(server + "/engine/nope", b'{"args":[]}')
    assert status == 404
    assert json.loads(data)["code"] == "UNKNOWN_FUNCTION"


def test_http_malformed_body_is_400(server):
    status, _, data = fetch(server + "/engine/snapshot", b"not json")
    assert status == 400
    assert json.loads(data)["code"] == "BAD_REQUEST"


def test_http_static_mime_and_no_store(server):
    status, headers, _ = fetch(server + "/main.js")
    assert status == 200
    assert headers["Content-Type"].startswith("text/javascript")
    assert headers["Cache-Control"] == "no-store"
    status, headers, _ = fetch(server + "/levels/level1.json")
    assert headers["Content-Type"].startswith("application/json")


def test_http_path_traversal_is_refused(server):
    import socket
    host, port = server.removeprefix("http://").split(":")
    with socket.create_connection((host, int(port))) as sock:
        sock.sendall(b"GET /../../etc/passwd HTTP/1.0\r\n\r\n")
        reply = sock.recv(4096)
    assert b"root:" not in reply
    sock2 = socket.create_connection((host, int(port)))
    sock2.sendall(b"GET /%2e%2e/%2e%2e/etc/passwd HTTP/1.0\r\n\r\n")
    reply2 = sock2.recv(4096)
    sock2.close()
    assert b"root:" not in reply2


def test_server_binds_loopback_only():
    httpd = engine_server.make_server(0)
    try:
        assert httpd.server_address[0] == "127.0.0.1"
    finally:
        httpd.server_close()


def raw(server, request_bytes, read=True):
    import socket
    host, port = server.removeprefix("http://").split(":")
    with socket.create_connection((host, int(port)), timeout=10) as sock:
        sock.sendall(request_bytes)
        chunks = []
        while read:
            chunk = sock.recv(65536)
            if not chunk:
                break
            chunks.append(chunk)
    return b"".join(chunks)


def test_handler_has_a_socket_timeout():
    assert engine_server.Handler.timeout == 5


def test_idle_connection_does_not_block_the_server(server):
    import socket
    import time
    host, port = server.removeprefix("http://").split(":")
    idle = socket.create_connection((host, int(port)))  # connects, sends nothing
    try:
        start = time.monotonic()
        status, _, _ = fetch(server + "/dev/")
        assert status == 200
        assert time.monotonic() - start < 8
    finally:
        idle.close()


def test_negative_and_oversized_content_length_are_400(server):
    for length in ("-1", str(64 * 1024 + 1), "abc"):
        reply = raw(server, (f"POST /engine/snapshot HTTP/1.0\r\nContent-Type: application/json\r\n"
                             f"Content-Length: {length}\r\n\r\n").encode())
        assert reply.startswith(b"HTTP/1.0 400"), (length, reply[:40])
        assert b"BAD_REQUEST" in reply


def test_foreign_host_header_is_403(server):
    reply = raw(server, b"GET /dev/ HTTP/1.0\r\nHost: evil.example\r\n\r\n")
    assert reply.startswith(b"HTTP/1.0 403") and b"FORBIDDEN_HOST" in reply
    reply = raw(server, (b"POST /engine/snapshot HTTP/1.0\r\nHost: evil.example\r\n"
                         b"Content-Type: application/json\r\nContent-Length: 2\r\n\r\n{}"))
    assert reply.startswith(b"HTTP/1.0 403") and b"FORBIDDEN_HOST" in reply


def test_localhost_and_loopback_hosts_are_allowed(server):
    port = server.rsplit(":", 1)[1]
    for host in (f"localhost:{port}", f"127.0.0.1:{port}"):
        status, _, _ = fetch(server + "/dev/", headers={"Host": host})
        assert status == 200, host
    # right name, wrong port (DNS rebinding to another local service) is refused
    status, _, _ = fetch(server + "/dev/", headers={"Host": "localhost:1"})
    assert status == 403


def test_post_requires_json_content_type(server):
    for ctype in ("text/plain", "application/x-www-form-urlencoded", None):
        request = urllib.request.Request(server + "/engine/snapshot", data=b"{}", method="POST")
        request.remove_header("Content-type")
        if ctype:
            request.add_header("Content-Type", ctype)
        try:
            urllib.request.urlopen(request)
            raise AssertionError("expected 415")
        except urllib.error.HTTPError as error:
            assert error.code == 415, ctype
    status, _, _ = fetch(server + "/engine/snapshot", b"{}", headers={"Content-Type": "application/json; charset=utf-8"})
    assert status == 200


@pytest.mark.parametrize("path", [
    "/dev/", "/dev/index.html", "/dev/engine_bridge.js", "/index.html", "/main.js", "/main.css",
    "/js/state.js", "/levels/level1.json",
])
def test_allowed_static_paths(server, path):
    status, _, _ = fetch(server + path)
    assert status == 200, path


@pytest.mark.parametrize("path", [
    "/.git/config", "/quantum/engine.py", "/dev/engine_server.py", "/dev/tests/test_engine_server.py",
    "/docs/06-handoff-juanjo.md", "/requirements-dev.txt", "/tests/helpers.mjs", "/dev/__pycache__/x.pyc",
    "/js/../quantum/engine.py", "/js/%2e%2e/quantum/engine.py", "/jsx/state.js", "/main.js.bak",
])
def test_everything_else_is_404(server, path):
    reply = raw(server, f"GET {path} HTTP/1.0\r\n\r\n".encode())
    assert reply.startswith(b"HTTP/1.0 404"), (path, reply[:40])


def test_root_redirects_to_dev(server):
    reply = raw(server, b"GET / HTTP/1.0\r\n\r\n")
    assert reply.startswith(b"HTTP/1.0 302") and b"Location: /dev/" in reply


def test_allowlist_function_unit():
    ok = engine_server.is_static_allowed
    assert ok("/dev/index.html") and ok("/js/main.js") and ok("/main.js")
    assert not ok("/dev/engine_server.py") and not ok("/dev/tests/x.js") and not ok("/.git/config")
