@echo off
set "ROOT=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%LyricsStatusLauncher.ps1"
