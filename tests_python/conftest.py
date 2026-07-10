# -*- coding: utf-8 -*-
"""
Fixtures do pytest do Motor Python (sidecar).

Coloca `release/` no sys.path para importar `sidecar` diretamente e provê um
servidor HTTP efêmero (bind 127.0.0.1:porta-do-SO) usando o handler dev do sidecar,
mais um mini-cliente urllib para os testes de HTTP.
"""
import base64
import json
import os
import struct
import sys
import threading
import urllib.error
import urllib.request

import pytest
from http.server import ThreadingHTTPServer

_RELEASE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "release")
if _RELEASE_DIR not in sys.path:
    sys.path.insert(0, _RELEASE_DIR)

import sidecar  # noqa: E402  (após ajustar o sys.path)

VITE_ORIGIN = "http://localhost:5173"


@pytest.fixture()
def server():
    """Sobe o handler dev do sidecar numa porta efêmera de 127.0.0.1 e devolve um
    cliente. Configura o CORS de dev com o origin do Vite."""
    sidecar.configure(dev=True, allowed_origins=[VITE_ORIGIN])
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), sidecar._SidecarDevHandler)
    host, port = httpd.server_address
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    client = _Client("http://127.0.0.1:%d" % port)
    try:
        yield client
    finally:
        httpd.shutdown()
        httpd.server_close()


class _Response:
    def __init__(self, status, body):
        self.status = status
        self.body = body

    def json(self):
        return json.loads(self.body.decode("utf-8")) if self.body else None


class _Client:
    def __init__(self, base):
        self.base = base
        self.token = sidecar.current_token()

    def request(self, method, path, body=None, headers=None, use_token=True):
        url = self.base + path
        h = dict(headers or {})
        if use_token and "X-Compute-Token" not in h:
            h["X-Compute-Token"] = self.token
        data = None
        if body is not None:
            data = body if isinstance(body, (bytes, bytearray)) else json.dumps(body).encode("utf-8")
            h.setdefault("Content-Type", "application/json")
        req = urllib.request.Request(url, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return _Response(resp.status, resp.read())
        except urllib.error.HTTPError as e:
            return _Response(e.code, e.read())

    def get(self, path, **kw):
        return self.request("GET", path, **kw)

    def post(self, path, body=None, **kw):
        return self.request("POST", path, body=body, **kw)

    def head(self, path, **kw):
        return self.request("HEAD", path, **kw)

    def delete(self, path, **kw):
        return self.request("DELETE", path, **kw)


def make_store(values, csv_id="csv1", col="m"):
    """Monta um store no formato do serializeCsvStore (M3) com uma coluna métrica
    base64 (float64 little-endian) — o mesmo formato que o front envia."""
    raw = struct.pack("<%dd" % len(values), *values)
    b64 = base64.b64encode(raw).decode("ascii")
    return {
        csv_id: {
            "name": "fixture",
            "headers": [col],
            "rowCount": len(values),
            "columnTypes": {col: "qty"},
            "columns": {
                col: {"kind": "num", "encoding": "base64", "length": len(values), "data": b64},
            },
        }
    }
