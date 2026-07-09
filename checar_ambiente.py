#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
checar_ambiente.py — Sonda do Ambiente Python Corporativo
============================================================

O QUE ESTE SCRIPT FAZ
----------------------
Verifica, na máquina onde ele é executado, se o ambiente Python consegue
instalar e importar os pacotes científicos que o "Motor Python" (execução
híbrida do simulador de crédito) usaria: numpy, scipy, scikit-learn e duckdb.

Ele:
  1. Reporta a versão do Python, do pip e a disponibilidade de `venv`.
  2. Cria um venv DESCARTÁVEL em uma pasta temporária do sistema.
  3. Tenta `pip install` (a partir do índice configurado) de cada pacote,
     um de cada vez, com timeout — e captura o erro quando falha.
  4. Tenta importar cada pacote instalado com sucesso e reporta a versão.
  5. Mede o tempo de cada etapa.
  6. Grava dois relatórios na mesma pasta deste script:
       - relatorio_ambiente.txt  (leitura humana)
       - relatorio_ambiente.json (estruturado, para uso posterior)
  7. Apaga o venv descartável ao final (sucesso ou falha).

O QUE ELE **NÃO** FAZ
----------------------
- Não envia nada pela rede além do próprio `pip install` (mesmo índice/proxy
  que o `pip` já usaria normalmente nesta máquina).
- Não lê, não copia e não reporta nenhum dado de negócio, arquivo do projeto
  ou informação pessoal — só metadados de ambiente (versões, tempos, erros
  de instalação).
- Não instala nada no Python "de verdade" da máquina — tudo acontece dentro
  do venv descartável, que é removido ao final.
- Não modifica nenhum outro arquivo do projeto.

COMO USAR
----------
Basta rodar com o Python 3.9+ disponível na máquina (não precisa de nenhuma
dependência extra instalada antes):

    python checar_ambiente.py

ou, em alguns ambientes Windows, dando duplo-clique no arquivo (se a
associação .py -> python estiver configurada) — nesse caso, ao final a
janela mostrará "Pressione ENTER para fechar..." para dar tempo de ler.

Depois de rodar, envie de volta os dois arquivos gerados
(`relatorio_ambiente.txt` e `relatorio_ambiente.json`) — eles alimentam a
decisão de quais pacotes entram no "tier full" da instalação e se são
necessárias wheels offline (e para quais pacotes).

Documentação de referência: docs/wiki/Arquitetura-Execucao-Hibrida.md (§5 P1)
e docs/wiki/Hibrido-Prompts-Sessoes.md (Sessão HP).
"""

import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
import venv
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------

# (nome do pacote no pip, nome do módulo para import)
PACOTES = [
    ("numpy", "numpy"),
    ("scipy", "scipy"),
    ("scikit-learn", "sklearn"),
    ("duckdb", "duckdb"),
]

TIMEOUT_INSTALL_SEG = 240  # scipy/sklearn podem demorar para baixar/compilar
TIMEOUT_IMPORT_SEG = 30

# Variáveis de ambiente relevantes para diagnóstico de proxy/índice do pip.
# Reportamos só SE estão definidas (booleano), nunca o valor — podem conter
# credenciais embutidas na URL.
VARS_AMBIENTE_SENSIVEIS = [
    "PIP_INDEX_URL",
    "PIP_EXTRA_INDEX_URL",
    "PIP_TRUSTED_HOST",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
]

PASTA_SCRIPT = os.path.dirname(os.path.abspath(__file__))
CAMINHO_TXT = os.path.join(PASTA_SCRIPT, "relatorio_ambiente.txt")
CAMINHO_JSON = os.path.join(PASTA_SCRIPT, "relatorio_ambiente.json")


def log(msg):
    print(msg, flush=True)


def agora_iso():
    return datetime.now(timezone.utc).astimezone().isoformat()


# ---------------------------------------------------------------------------
# Etapa 1 — informações básicas do ambiente
# ---------------------------------------------------------------------------

def coletar_info_basica():
    log("→ Coletando informações básicas do ambiente...")
    info = {
        "data_hora": agora_iso(),
        "python_versao": platform.python_version(),
        "python_implementacao": platform.python_implementation(),
        "python_executavel": sys.executable,
        "so": platform.system(),
        "so_versao": platform.version(),
        "so_release": platform.release(),
        "arquitetura": platform.machine(),
        "bits": platform.architecture()[0],
        "venv_modulo_disponivel": True,  # já importamos venv com sucesso acima
    }

    # Versão do pip do interpretador atual (sem instalar nada, só consulta)
    try:
        r = subprocess.run(
            [sys.executable, "-m", "pip", "--version"],
            capture_output=True, text=True, timeout=20,
        )
        info["pip_versao_sistema"] = r.stdout.strip() if r.returncode == 0 else None
        info["pip_disponivel_sistema"] = r.returncode == 0
    except Exception as e:
        info["pip_versao_sistema"] = None
        info["pip_disponivel_sistema"] = False
        info["pip_erro_sistema"] = str(e)

    # Variáveis de proxy/índice — só presença, nunca o valor
    info["variaveis_ambiente_definidas"] = {
        v: (v in os.environ) for v in VARS_AMBIENTE_SENSIVEIS
    }

    return info


# ---------------------------------------------------------------------------
# Etapa 2 — criação do venv descartável
# ---------------------------------------------------------------------------

def criar_venv_descartavel():
    log("→ Criando venv descartável em pasta temporária...")
    pasta_temp = tempfile.mkdtemp(prefix="checar_ambiente_venv_")
    caminho_venv = os.path.join(pasta_temp, "venv")

    resultado = {
        "pasta_temporaria": pasta_temp,
        "sucesso": False,
        "tempo_seg": None,
        "erro": None,
        "python_venv": None,
    }

    t0 = time.monotonic()
    try:
        venv.create(caminho_venv, with_pip=True)
        resultado["sucesso"] = True
    except Exception as e:
        resultado["erro"] = f"{type(e).__name__}: {e}"
    resultado["tempo_seg"] = round(time.monotonic() - t0, 2)

    if resultado["sucesso"]:
        if platform.system() == "Windows":
            python_venv = os.path.join(caminho_venv, "Scripts", "python.exe")
        else:
            python_venv = os.path.join(caminho_venv, "bin", "python")
        if os.path.exists(python_venv):
            resultado["python_venv"] = python_venv
        else:
            resultado["sucesso"] = False
            resultado["erro"] = (
                f"venv criado mas executável Python não encontrado em {python_venv}"
            )

    return resultado, pasta_temp


# ---------------------------------------------------------------------------
# Etapa 3 — pip install + import, pacote a pacote
# ---------------------------------------------------------------------------

def testar_pacote(python_venv, nome_pip, nome_import):
    log(f"→ Testando pacote: {nome_pip} ...")
    resultado = {
        "pacote": nome_pip,
        "modulo_import": nome_import,
        "instalacao": {
            "sucesso": False,
            "tempo_seg": None,
            "codigo_retorno": None,
            "erro_resumo": None,
        },
        "importacao": {
            "sucesso": False,
            "tempo_seg": None,
            "versao": None,
            "erro_resumo": None,
        },
    }

    # --- instalação ---
    t0 = time.monotonic()
    try:
        r = subprocess.run(
            [
                python_venv, "-m", "pip", "install",
                "--disable-pip-version-check", "--no-input",
                nome_pip,
            ],
            capture_output=True, text=True, timeout=TIMEOUT_INSTALL_SEG,
        )
        resultado["instalacao"]["codigo_retorno"] = r.returncode
        resultado["instalacao"]["sucesso"] = r.returncode == 0
        if r.returncode != 0:
            # guarda só as últimas linhas do stderr — o essencial do erro
            linhas = (r.stderr or r.stdout or "").strip().splitlines()
            resultado["instalacao"]["erro_resumo"] = "\n".join(linhas[-15:])
    except subprocess.TimeoutExpired:
        resultado["instalacao"]["erro_resumo"] = (
            f"Timeout após {TIMEOUT_INSTALL_SEG}s"
        )
    except Exception as e:
        resultado["instalacao"]["erro_resumo"] = f"{type(e).__name__}: {e}"
    resultado["instalacao"]["tempo_seg"] = round(time.monotonic() - t0, 2)

    if not resultado["instalacao"]["sucesso"]:
        log(f"   ✗ Instalação de {nome_pip} falhou.")
        return resultado

    log(f"   ✓ Instalação de {nome_pip} OK ({resultado['instalacao']['tempo_seg']}s).")

    # --- importação ---
    t0 = time.monotonic()
    codigo = (
        f"import {nome_import} as _m; "
        f"print(getattr(_m, '__version__', 'desconhecida'))"
    )
    try:
        r = subprocess.run(
            [python_venv, "-c", codigo],
            capture_output=True, text=True, timeout=TIMEOUT_IMPORT_SEG,
        )
        resultado["importacao"]["sucesso"] = r.returncode == 0
        if r.returncode == 0:
            resultado["importacao"]["versao"] = r.stdout.strip()
        else:
            linhas = (r.stderr or r.stdout or "").strip().splitlines()
            resultado["importacao"]["erro_resumo"] = "\n".join(linhas[-15:])
    except subprocess.TimeoutExpired:
        resultado["importacao"]["erro_resumo"] = (
            f"Timeout após {TIMEOUT_IMPORT_SEG}s"
        )
    except Exception as e:
        resultado["importacao"]["erro_resumo"] = f"{type(e).__name__}: {e}"
    resultado["importacao"]["tempo_seg"] = round(time.monotonic() - t0, 2)

    if resultado["importacao"]["sucesso"]:
        log(f"   ✓ Import de {nome_import} OK (versão {resultado['importacao']['versao']}).")
    else:
        log(f"   ✗ Import de {nome_import} falhou.")

    return resultado


# ---------------------------------------------------------------------------
# Etapa 4 — geração dos relatórios
# ---------------------------------------------------------------------------

def montar_conclusao(resultados_pacotes):
    ok = [r["pacote"] for r in resultados_pacotes
          if r["instalacao"]["sucesso"] and r["importacao"]["sucesso"]]
    falhou = [r["pacote"] for r in resultados_pacotes
              if not (r["instalacao"]["sucesso"] and r["importacao"]["sucesso"])]
    return {
        "pacotes_ok_via_indice": ok,
        "pacotes_precisam_wheel_offline": falhou,
    }


def gravar_relatorio_json(dados):
    with open(CAMINHO_JSON, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=2)


def gravar_relatorio_txt(dados):
    linhas = []
    linhas.append("=" * 70)
    linhas.append("RELATÓRIO — Sonda do Ambiente Python Corporativo")
    linhas.append("=" * 70)
    linhas.append(f"Gerado em: {dados['info_basica']['data_hora']}")
    linhas.append("")

    linhas.append("-- Ambiente --")
    ib = dados["info_basica"]
    linhas.append(f"Sistema operacional : {ib['so']} {ib['so_release']} ({ib['arquitetura']}, {ib['bits']})")
    linhas.append(f"Python              : {ib['python_versao']} ({ib['python_implementacao']})")
    linhas.append(f"Executável Python   : {ib['python_executavel']}")
    if ib.get("pip_disponivel_sistema"):
        linhas.append(f"pip (sistema)       : {ib.get('pip_versao_sistema')}")
    else:
        linhas.append("pip (sistema)       : NÃO disponível / erro ao consultar")
    linhas.append("")
    linhas.append("Variáveis de proxy/índice definidas (só presença, sem valores):")
    for var, definida in ib["variaveis_ambiente_definidas"].items():
        if definida:
            linhas.append(f"  - {var}: definida")
    if not any(ib["variaveis_ambiente_definidas"].values()):
        linhas.append("  (nenhuma definida)")
    linhas.append("")

    venv_info = dados["venv"]
    linhas.append("-- Criação do venv descartável --")
    if venv_info["sucesso"]:
        linhas.append(f"Status: OK ({venv_info['tempo_seg']}s)")
    else:
        linhas.append(f"Status: FALHOU — {venv_info['erro']}")
    linhas.append("")

    linhas.append("-- Pacotes testados --")
    if not dados.get("pacotes"):
        linhas.append("(nenhum pacote testado — venv não pôde ser criado)")
    for r in dados.get("pacotes", []):
        linhas.append(f"* {r['pacote']} (import: {r['modulo_import']})")
        inst = r["instalacao"]
        if inst["sucesso"]:
            linhas.append(f"    Instalação: OK ({inst['tempo_seg']}s)")
        else:
            linhas.append(f"    Instalação: FALHOU ({inst['tempo_seg']}s)")
            if inst["erro_resumo"]:
                for l in inst["erro_resumo"].splitlines():
                    linhas.append(f"      | {l}")
        imp = r["importacao"]
        if inst["sucesso"]:
            if imp["sucesso"]:
                linhas.append(f"    Import:     OK (versão {imp['versao']}, {imp['tempo_seg']}s)")
            else:
                linhas.append(f"    Import:     FALHOU ({imp['tempo_seg']}s)")
                if imp["erro_resumo"]:
                    for l in imp["erro_resumo"].splitlines():
                        linhas.append(f"      | {l}")
        linhas.append("")

    conclusao = dados.get("conclusao", {})
    linhas.append("-- Conclusão --")
    ok = conclusao.get("pacotes_ok_via_indice", [])
    falhou = conclusao.get("pacotes_precisam_wheel_offline", [])
    linhas.append(f"Instalam via índice normalmente : {', '.join(ok) if ok else '(nenhum)'}")
    linhas.append(f"Precisam de wheel offline        : {', '.join(falhou) if falhou else '(nenhum)'}")
    linhas.append("")
    linhas.append("Nenhum dado de negócio foi coletado — só metadados de ambiente.")
    linhas.append("=" * 70)

    with open(CAMINHO_TXT, "w", encoding="utf-8") as f:
        f.write("\n".join(linhas))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    log("=" * 70)
    log("Sonda do Ambiente Python Corporativo — checar_ambiente.py")
    log("=" * 70)
    log("Este script NÃO coleta nenhum dado de negócio — só metadados de")
    log("ambiente (versões, tempos, erros de instalação). Tudo acontece em")
    log("um venv descartável, removido ao final.")
    log("")

    t0_total = time.monotonic()
    dados = {}

    dados["info_basica"] = coletar_info_basica()

    venv_resultado, pasta_temp = criar_venv_descartavel()
    dados["venv"] = {k: v for k, v in venv_resultado.items() if k != "python_venv"}

    dados["pacotes"] = []
    try:
        if venv_resultado["sucesso"]:
            python_venv = venv_resultado["python_venv"]
            for nome_pip, nome_import in PACOTES:
                dados["pacotes"].append(
                    testar_pacote(python_venv, nome_pip, nome_import)
                )
        else:
            log(f"✗ Não foi possível criar o venv descartável: {venv_resultado['erro']}")
            log("  Pulando testes de pacotes.")
    finally:
        log("→ Limpando venv descartável...")
        shutil.rmtree(pasta_temp, ignore_errors=True)

    dados["conclusao"] = montar_conclusao(dados["pacotes"])
    dados["tempo_total_seg"] = round(time.monotonic() - t0_total, 2)

    gravar_relatorio_json(dados)
    gravar_relatorio_txt(dados)

    log("")
    log("=" * 70)
    log(f"Concluído em {dados['tempo_total_seg']}s.")
    log(f"Relatório (texto)      : {CAMINHO_TXT}")
    log(f"Relatório (json)       : {CAMINHO_JSON}")
    log("Envie esses dois arquivos de volta para alimentar a decisão de")
    log("wheels offline / tier de instalação do Motor Python.")
    log("=" * 70)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("\nInterrompido pelo usuário.")
        sys.exit(1)
    finally:
        if platform.system() == "Windows" and sys.stdin.isatty():
            input("\nPressione ENTER para fechar...")
