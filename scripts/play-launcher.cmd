@echo off
rem One-click local playtesting: starts scripts\play-launcher.js and opens the game picker.
rem Leave this window open while playing; close it (or press Stop in the picker) to stop.
title Pleura local launcher - close to stop
cd /d "%~dp0.."
node scripts\play-launcher.js
if errorlevel 1 pause
