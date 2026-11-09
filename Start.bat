@echo off
title Axiom YOLO Auto Label
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONUNBUFFERED=1
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" call Setup.bat
if errorlevel 1 exit /b 1
".venv\Scripts\python.exe" launch.py
if errorlevel 1 pause
