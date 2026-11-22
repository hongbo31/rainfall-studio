@echo off
setlocal
if defined RAINFALL_PWSH goto start
where pwsh.exe >nul 2>nul
if not errorlevel 1 set "RAINFALL_PWSH=pwsh.exe"
if not defined RAINFALL_PWSH if defined ProgramW6432 if exist "%ProgramW6432%\PowerShell\7\pwsh.exe" set "RAINFALL_PWSH=%ProgramW6432%\PowerShell\7\pwsh.exe"
if not defined RAINFALL_PWSH if defined ProgramFiles if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" set "RAINFALL_PWSH=%ProgramFiles%\PowerShell\7\pwsh.exe"
for %%I in ("%~dp0.") do set "RAINFALL_PORTABLE_PWSH=%%~fI-browser-dev\tools\pwsh\pwsh.exe"
if not defined RAINFALL_PWSH if exist "%RAINFALL_PORTABLE_PWSH%" set "RAINFALL_PWSH=%RAINFALL_PORTABLE_PWSH%"
if not defined RAINFALL_PWSH (
    echo PowerShell 7 is required. Add pwsh.exe to PATH or set RAINFALL_PWSH.
    if "%~1"=="" pause
    exit /b 1
)
:start
"%RAINFALL_PWSH%" -NoProfile -File "%~dp0scripts\Start-Rainfall-Browser.ps1" %*
if errorlevel 1 (
    echo.
    echo Rainfall Studio could not start. Read the error above.
    if "%~1"=="" pause
    exit /b 1
)
