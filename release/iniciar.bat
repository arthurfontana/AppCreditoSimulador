@echo off
cd /d "%~dp0"
echo Iniciando o AppCredito Simulador...
echo.
rem serve.py adiciona os headers COOP/COEP -> cross-origin isolation ATIVO,
rem habilitando o SharedArrayBuffer (a base nao e mais clonada pro worker).
start "" python serve.py 8080
timeout /t 2 /nobreak > nul
start "" "http://localhost:8080"
echo.
echo Servidor rodando em http://localhost:8080
echo.
echo Mantenha esta janela aberta enquanto usar o sistema.
echo Para encerrar: feche esta janela e feche a aba do navegador.
echo.
pause
