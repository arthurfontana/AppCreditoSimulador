@echo off
cd /d "%~dp0"
echo Iniciando o AppCredito Simulador...
echo.
start "" python -m http.server 8080
timeout /t 2 /nobreak > nul
start "" "http://localhost:8080"
echo.
echo Servidor rodando em http://localhost:8080
echo.
echo Mantenha esta janela aberta enquanto usar o sistema.
echo Para encerrar: feche esta janela e feche a aba do navegador.
echo.
pause
