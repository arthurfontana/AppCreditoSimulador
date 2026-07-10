#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Servidor local do AppCredito Simulador com *cross-origin isolation* + Motor Python.

O `python -m http.server` padrao NAO envia os headers COOP/COEP, entao
`crossOriginIsolated` fica false no navegador e o SharedArrayBuffer (Fase 2 da
Otimizacao de Memoria) nao ativa: a base colunar cai no clone (copia ~200MB) ao
ir para o Web Worker. Este servidor serve a pasta do release exatamente como o
http.server padrao, mas acrescenta os dois headers necessarios para habilitar o
SharedArrayBuffer compartilhado entre a thread principal e o worker.

  Cross-Origin-Opener-Policy:   same-origin
  Cross-Origin-Embedder-Policy: require-corp

Todos os assets sao bundlados na mesma origem, entao require-corp nao bloqueia
nada. Uso: `python serve.py [porta]` (porta padrao 8080).

Alem dos estaticos, este servidor MONTA os endpoints do Motor Python (sidecar de
Execucao Hibrida) sob `/api/compute/*`, na MESMA porta/origem do app (DEC-HX-003 —
docs/wiki/Arquitetura-Execucao-Hibrida.md). Isso elimina CORS e simplifica o
pareamento: o front (ComputeRouter, src/computeRouter.js) fala com o sidecar por
fetch same-origin. O sidecar e OPT-IN e SILENCIOSO: se os pacotes cientificos nao
estiverem instalados, o warm-up so reporta tier `stdlib` e o app segue 100% no
navegador (DEC-HX-001). Toda a logica da API vive em `sidecar.py` (um arquivo,
stdlib); aqui so a montamos antes do fallback para os arquivos estaticos.
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

try:
    import sidecar  # mesmo diretorio (release/)
except Exception as _e:  # pragma: no cover - o app funciona sem o sidecar
    sidecar = None
    _sidecar_import_error = _e


class COIRequestHandler(SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler + headers COOP/COEP + endpoints do Motor Python."""

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        # Evita cache agressivo do navegador entre builds locais.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    # A API do Motor Python e tentada ANTES do tratamento de estaticos. Se o path nao
    # for /api/compute/*, `handle_api` devolve False e seguimos o fluxo padrao.
    def _try_api(self, method):
        return sidecar is not None and sidecar.handle_api(self, method)

    def do_GET(self):
        if self._try_api("GET"):
            return
        super().do_GET()

    def do_HEAD(self):
        if self._try_api("HEAD"):
            return
        super().do_HEAD()

    def do_POST(self):
        if self._try_api("POST"):
            return
        self.send_error(405, "Method Not Allowed")

    def do_DELETE(self):
        if self._try_api("DELETE"):
            return
        self.send_error(405, "Method Not Allowed")

    def do_OPTIONS(self):
        if self._try_api("OPTIONS"):
            return
        self.send_error(405, "Method Not Allowed")


def main():
    port = 8080
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print(f"Porta invalida: {sys.argv[1]} — usando 8080.")

    # Serve a pasta onde este script vive (o release/), nao o CWD do processo.
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    # Sobe o Motor Python na MESMA origem (release): warm-up assincrono da deteccao
    # de tier no boot (DEC-HX-004) — nunca importa pacote inline num request.
    if sidecar is not None:
        sidecar.configure(dev=False)
        sidecar.start_warmup()

    # ThreadingHTTPServer: jobs longos do sidecar (polling) nao bloqueiam o app.
    httpd = ThreadingHTTPServer(("", port), COIRequestHandler)
    print(f"Servindo AppCredito Simulador em http://localhost:{port}")
    print("Cross-origin isolation ATIVO (SharedArrayBuffer habilitado).")
    if sidecar is not None:
        print(f"Motor Python (sidecar) montado em /api/compute/* — tier detectado no boot.")
    else:
        print("Motor Python (sidecar) indisponivel — app segue 100% no navegador.")
    print("Pressione Ctrl+C para encerrar.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrando servidor.")
        httpd.server_close()


if __name__ == "__main__":
    main()
