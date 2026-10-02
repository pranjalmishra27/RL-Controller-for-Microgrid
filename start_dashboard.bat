@echo off
echo.
echo ================================================
echo   Microgrid RL Dashboard - Starting Server
echo ================================================
echo.
echo [1] Installing / updating dependencies...
pip install flask flask-cors numpy gymnasium --quiet
echo.
echo [2] Starting Flask dashboard server...
echo     Open your browser at: http://localhost:5000
echo.
cd /d "%~dp0"
python frontend\app.py
pause
