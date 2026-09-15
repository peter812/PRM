@echo off
REM Dev mode: Whisper (speech-to-text) in Docker, the app natively with hot reload.
REM Postgres is whatever DATABASE_URL in .env points at.
cd /d "%~dp0"

if not exist .env (
  echo No .env file. Copy .env.example to .env and set DATABASE_URL first.
  exit /b 1
)

echo Starting Whisper...
docker compose -f docker-compose.whisper.yml up -d
if errorlevel 1 exit /b 1

echo Starting app (dev)...
npm run dev
