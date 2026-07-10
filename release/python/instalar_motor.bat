@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem ===========================================================================
rem  instalar_motor.bat - Motor Python (Execucao Hibrida) - instalacao em camadas
rem ===========================================================================
rem
rem  O que faz (P1 - docs/wiki/Arquitetura-Execucao-Hibrida.md, secao 5):
rem    1. Cria um ambiente virtual descartavel em .venv\ (nao mexe no Python do
rem       sistema).
rem    2. Para cada pacote de requirements.txt, tenta primeiro
rem       "pip install" DO INDICE (validado pela sonda HP: os 4 pacotes instalam
rem       do indice na maquina alvo).
rem    3. Para o que FALHAR, cai para a camada de CONTINGENCIA
rem       "pip install --no-index --find-links wheels\" (wheels offline
rem       embarcadas). O relatorio da HP nao apontou nenhuma wheel imprescindivel
rem       nesta maquina, entao a pasta wheels\ vem VAZIA por padrao (so um
rem       LEIAME.txt). Ela so e util se OUTRA maquina reportar falha real de
rem       instalacao pelo indice - ai voce popula wheels\ (veja o LEIAME).
rem
rem  Antes de instalar, o ideal e rodar checar_ambiente.py (a sonda) nesta
rem  maquina - ele diz, sem instalar nada de verdade, o que o pip corporativo
rem  realmente baixa.
rem
rem  Se NADA instalar, tudo bem: o app continua 100% no navegador (tier stdlib).
rem  O Motor Python e OPT-IN e so ACELERA/AMPLIA - nunca e requisito (DEC-HX-001).
rem ===========================================================================

echo.
echo === Motor Python - instalacao em camadas ===
echo.

rem --- localizar o Python ---
where py >nul 2>nul
if %errorlevel%==0 (
  set "PY=py -3"
) else (
  where python >nul 2>nul
  if %errorlevel%==0 (
    set "PY=python"
  ) else (
    echo [ERRO] Python nao encontrado no PATH. Instale o Python 3.9+ e tente de novo.
    goto :fim
  )
)

echo Usando interpretador: !PY!
!PY! --version

rem --- criar venv descartavel ---
if not exist ".venv\" (
  echo.
  echo Criando ambiente virtual em .venv\ ...
  !PY! -m venv .venv
  if !errorlevel! neq 0 (
    echo [ERRO] Falha ao criar o venv. O modulo venv esta disponivel?
    goto :fim
  )
)

set "VPY=.venv\Scripts\python.exe"
if not exist "!VPY!" (
  echo [ERRO] venv criado mas Python nao encontrado em !VPY!.
  goto :fim
)

echo.
echo Atualizando o pip do venv ...
"!VPY!" -m pip install --upgrade --disable-pip-version-check pip

rem --- ler os pacotes de requirements.txt (ignora comentarios e linhas vazias) ---
echo.
echo Instalando pacotes (indice primeiro; wheels\ como contingencia) ...
set "FALHAS="

for /f "usebackq eol=# tokens=* delims=" %%L in ("requirements.txt") do (
  set "SPEC=%%L"
  if not "!SPEC!"=="" (
    echo.
    echo --- !SPEC! ---
    "!VPY!" -m pip install --disable-pip-version-check --no-input "!SPEC!"
    if !errorlevel! neq 0 (
      echo   Indice falhou para !SPEC!. Tentando wheels offline ^(--no-index --find-links wheels\^) ...
      "!VPY!" -m pip install --disable-pip-version-check --no-input --no-index --find-links wheels "!SPEC!"
      if !errorlevel! neq 0 (
        echo   [FALHOU] !SPEC! - nem indice nem wheels offline.
        set "FALHAS=!FALHAS! !SPEC!"
      ) else (
        echo   OK via wheels offline.
      )
    ) else (
      echo   OK via indice.
    )
  )
)

echo.
echo === Resumo ===
if defined FALHAS (
  echo Pacotes que NAO instalaram:!FALHAS!
  echo.
  echo O app continua funcionando no navegador ^(tier stdlib ou parcial^).
  echo Para tier full, resolva a instalacao dos pacotes acima ^(veja wheels\LEIAME.txt^).
) else (
  echo Todos os pacotes instalados. Tier `full` disponivel no proximo boot.
)

echo.
echo Verificando importacao ^(a 1a carga do sklearn pode demorar sob antivirus^) ...
"!VPY!" -c "import importlib,sys; [print(' ', m, '->', getattr(importlib.import_module(m),'__version__','?')) for m in ['numpy','scipy'] ]" 2>nul

:fim
echo.
pause
endlocal
