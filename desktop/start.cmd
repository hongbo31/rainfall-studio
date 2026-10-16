@echo off
cd /d "%~dp0.."
if "%~1"=="--check" (
 node --check server.mjs
 exit /b %errorlevel%
)
echo Rainfall local WEB PROTOTYPE: http://127.0.0.1:4173
echo Open that address in your browser. Ctrl+C stops this server.
node server.mjs
