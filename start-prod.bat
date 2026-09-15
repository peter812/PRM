@echo off
REM Prod mode: app + Whisper + Postgres, all in Docker (docker-compose.yml).
cd /d "%~dp0"

if not exist .env (
  echo No .env file. Copy .env.example to .env and set DATABASE_URL first.
  exit /b 1
)

docker compose up -d --build
if errorlevel 1 exit /b 1
echo.
echo App:     http://localhost:5000
echo Whisper: http://localhost:8000  (model downloads in the background on first start)
echo Logs:    docker compose logs -f
