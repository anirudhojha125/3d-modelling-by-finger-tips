@echo off
title Hand Gesture 3D Block Builder
cd /d "%~dp0"

echo ================================================
echo   Hand Gesture 3D Block Builder
echo ================================================
echo.
echo Starting local web server...
echo.

REM --- Find an available Python interpreter ---
set "PYCMD="
where py >nul 2>nul && set "PYCMD=py"
if not defined PYCMD where python >nul 2>nul && set "PYCMD=python"
if not defined PYCMD where python3 >nul 2>nul && set "PYCMD=python3"

if not defined PYCMD (
    echo [ERROR] Python was not found on this system.
    echo.
    echo This app needs a local web server because it uses ES modules.
    echo Please install Python from https://www.python.org/ and make sure
    echo "Add Python to PATH" is checked during installation.
    echo.
    pause
    exit /b 1
)

REM --- Open the default browser after a short delay (lets the server bind) ---
start "" cmd /c "timeout /t 2 >nul & start "" http://localhost:8000"

echo Local server running at:  http://localhost:8000
echo.
echo Allow webcam access when your browser asks for it.
echo.
echo Close this window to stop the server.
echo ------------------------------------------------
echo.

%PYCMD% -m http.server 8000
