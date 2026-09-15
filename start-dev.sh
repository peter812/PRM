#!/usr/bin/env sh
# Dev mode: Whisper (speech-to-text) in Docker, the app natively with hot reload.
# Postgres is whatever DATABASE_URL in .env points at.
set -e
cd "$(dirname "$0")"

[ -f .env ] || { echo "No .env file. Copy .env.example to .env and set DATABASE_URL first."; exit 1; }

echo "Starting Whisper..."
docker compose -f docker-compose.whisper.yml up -d

echo "Starting app (dev)..."
npm run dev
