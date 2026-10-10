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


def test_run_circuit_before_building_reports_mismatch():
    engine_server.dispatch("load_level", ["level1"])
    engine_server.dispatch("new_session", ["level1"])
    status, payload = body(engine_server.dispatch("run_circuit", []))
    assert status == 200
    assert payload["code"] == "CIRCUIT_MISMATCH"


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


def fetch(url, data=None):
    request = urllib.request.Request(url, data=data, method="POST" if data is not None else "GET")
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
