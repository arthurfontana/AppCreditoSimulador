# tests_python — GATE do Motor Python (sidecar)

Testes pytest do `release/sidecar.py` (Execução Híbrida, Sessão H5). Rodam **sem
nenhuma dependência científica** (numpy/scipy/sklearn/duckdb são opcionais — os
testes de tier manipulam o estado do warm-up diretamente).

## Rodar localmente

```bash
pip install -r tests_python/requirements-dev.txt   # só pytest
pytest tests_python/ -q
```

O `conftest.py` põe `release/` no `sys.path` para importar `sidecar` e sobe um
`ThreadingHTTPServer` efêmero em `127.0.0.1` para os testes de HTTP.

## O que cobre

- `health` (sem token) e `token` (gate de origem — mesma origem OK, origem
  estranha 403).
- Autenticação por `X-Compute-Token` (401 sem token).
- `capabilities` **durante** o warm-up (`loading` ⇒ tier `stdlib`) e **depois**
  (numpy+scipy ⇒ `full`; sklearn ausente **não** rebaixa o tier).
- Dataset round-trip por hash (POST idempotente + HEAD 200/404).
- Ciclo de job `echo_stats` (rowCount + soma) e cancelamento (best-effort).

Não é o GATE cross-runtime (fixtures douradas) — esse é da H7 em diante, quando
houver dupla implementação de fato (DEC-HX-005). Aqui só se prova o round-trip
ponta a ponta do protocolo.
