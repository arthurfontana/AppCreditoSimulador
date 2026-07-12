@echo off
cd /d "%~dp0"
echo Iniciando o AppCredito Simulador...
echo.
rem serve.py adiciona os headers COOP/COEP -> cross-origin isolation ATIVO,
rem habilitando o SharedArrayBuffer (a base nao e mais clonada pro worker).
rem
rem Motor Python (tier full): se "python\instalar_motor.bat" ja rodou uma vez,
rem os pacotes cientificos vivem no venv python\.venv\, nao no Python do
rem sistema. Sem isso, "python serve.py" pegaria o Python do PATH e o sidecar
rem subiria em tier stdlib mesmo com numpy/scipy instalados. Prefere o venv
rem quando existe; senao cai pro Python do sistema (DEC-HX-001: opt-in, nunca
rem bloqueia o boot do app).
set "PY_EXE=python\.venv\Scripts\python.exe"
if exist "%PY_EXE%" (
  echo Motor Python: venv encontrado - tier full.
) else (
  echo Motor Python: venv nao encontrado - iniciando em tier stdlib.
  echo Dica: rode python\instalar_motor.bat uma vez para habilitar o tier full.
  set "PY_EXE=python"
)
echo.
start "" "%PY_EXE%" serve.py 8080
timeout /t 2 /nobreak > nul
start "" "http://localhost:8080"
echo.
echo Servidor rodando em http://localhost:8080
echo.
echo Mantenha esta janela aberta enquanto usar o sistema.
echo Para encerrar: feche esta janela e feche a aba do navegador.
echo.
pause
