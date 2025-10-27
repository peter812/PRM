#!/bin/bash

# Database Setup Script for People Manager CRM
# This script creates the database on the PostgreSQL server

set -e

echo "====================================="
echo "People Manager CRM - Database Setup"
echo "====================================="
echo ""

# Default values (can be overridden by environment variables)
DB_HOST="${DB_HOST:-pbe.im}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-people}"
DB_PASSWORD="${DB_PASSWORD:-people812}"
DB_NAME="${DB_NAME:-people_crm}"

echo "Configuration:"
echo "  Host: $DB_HOST"
echo "  Port: $DB_PORT"
echo "  User: $DB_USER"
echo "  Database: $DB_NAME"
echo ""

# Check if psql is installed
if ! command -v psql &> /dev/null; then
    echo "ERROR: psql is not installed."
    echo "Please install PostgreSQL client:"
    echo "  Ubuntu/Debian: sudo apt-get install postgresql-client"
    echo "  macOS: brew install postgresql"
    echo "  Windows: Download from https://www.postgresql.org/download/"
    exit 1
fi

echo "Step 1: Checking if database exists..."

# Check if database exists
DB_EXISTS=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null || echo "")

if [ "$DB_EXISTS" = "1" ]; then
    echo "✓ Database '$DB_NAME' already exists!"
    echo ""
    echo "You can now run the application:"
    echo "  docker-compose up"
    echo ""
    echo "Or run database migrations:"
    echo "  npm run db:push"
    exit 0
fi

echo "Database '$DB_NAME' does not exist. Creating it..."
echo ""

# Create the database
echo "Step 2: Creating database '$DB_NAME'..."
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "CREATE DATABASE $DB_NAME;"

if [ $? -eq 0 ]; then
    echo "✓ Database '$DB_NAME' created successfully!"
    echo ""
    echo "Next steps:"
    echo "  1. Run database migrations:"
    echo "     npm run db:push"
    echo ""
    echo "  2. Start the application:"
    echo "     docker-compose up"
    echo ""
    echo "  3. Or run locally:"
    echo "     npm run dev"
else
    echo "✗ Failed to create database"
    echo "Please check your credentials and try again"
    exit 1
fi
