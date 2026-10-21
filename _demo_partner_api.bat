@echo off
chcp 65001 >nul
title Demo API Doi Tac - Blockchain Data Integrity
cd /d "%~dp0"

echo =======================================================
echo   DEMO API DOI TAC (B2B) - Blockchain Data Integrity
echo =======================================================
echo.

node _demo_partner_api.mjs demo

echo.
pause
