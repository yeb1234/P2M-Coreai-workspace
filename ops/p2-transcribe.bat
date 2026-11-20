@echo off
setlocal
cd /d "%~dp0.."
title P2 7.2 Transcribe
echo P2 7.2 Transcribe control plane
echo http://127.0.0.1:12703
echo.
python artifacts\pipeline-monitor\transcribe_console.py
if errorlevel 1 pause
