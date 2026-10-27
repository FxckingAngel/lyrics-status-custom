@echo off
setlocal
set "ROOT=%~dp0"
set "POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%POWERSHELL%" set "POWERSHELL=powershell.exe"
"%POWERSHELL%" -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%ROOT%LyricsStatusLauncher.ps1"
if errorlevel 1 (
  echo LyricsStatus could not start. Run this file from the extracted folder.
  pause
)
endlocal
