#!/usr/bin/env sh
# Prod mode: app + Whisper + Postgres, all in Docker (docker-compose.yml).
set -e
cd "$(dirname "$0")"

[ -f .env ] || { echo "No .env file. Copy .env.example to .env and set DATABASE_URL first."; exit 1; }

docker compose up -d --build
echo
echo "App:     http://localhost:5000"
echo "Whisper: http://localhost:8000  (model downloads in the background on first start)"
echo "Logs:    docker compose logs -f"
