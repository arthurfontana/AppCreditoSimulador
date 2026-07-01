#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Servidor local do AppCredito Simulador com *cross-origin isolation*.

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
"""
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class COIRequestHandler(SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler + headers de cross-origin isolation."""

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        # Evita cache agressivo do navegador entre builds locais.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    port = 8080
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print(f"Porta invalida: {sys.argv[1]} — usando 8080.")

    # Serve a pasta onde este script vive (o release/), nao o CWD do processo.
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    httpd = HTTPServer(("", port), COIRequestHandler)
    print(f"Servindo AppCredito Simulador em http://localhost:{port}")
    print("Cross-origin isolation ATIVO (SharedArrayBuffer habilitado).")
    print("Pressione Ctrl+C para encerrar.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrando servidor.")
        httpd.server_close()


if __name__ == "__main__":
    main()
