@echo off
setlocal
if "%~1"=="--check" (
    call "%~dp0..\Start-Rainfall-Browser.bat" -BuildOnly
    exit /b
)
call "%~dp0..\Start-Rainfall-Browser.bat" %*
exit /b %errorlevel%
