# Docker Deployment Guide

This guide explains how to run the People Manager CRM in a Docker container.

## Prerequisites

- Docker installed on your system
- Docker Compose installed (optional, but recommended)
- Access to the PostgreSQL database at `pbe.im:3306`
- S3-compatible storage configured
- PostgreSQL database created (see Database Setup below)

## Database Setup (Required First Step!)

⚠️ **Important**: You must create the PostgreSQL database before running the application for the first time.

### ✨ Automatic Database Initialization (New!)

The application now **automatically sets up the database** when there are no users!

When you start the app:
- ✅ If **users exist**: Normal startup
- 🔄 If **no users**: Automatically drops all tables, runs migrations, and seeds default data

This means you only need to:
1. Create the empty database (see below)
2. Start the application - it handles the rest!

### Quick Database Setup

Use the provided setup script to create the database automatically:

```bash
# Make the script executable
chmod +x setup-database.sh

# Run the setup
./setup-database.sh
```

### Manual Database Setup

If you prefer manual setup or the script doesn't work:

```bash
# Connect to PostgreSQL
psql -h pbe.im -p 3306 -U people -d postgres

# Create the database
CREATE DATABASE people_crm;

# Exit
\q
```

### Manual Migration (Optional)

The app automatically runs migrations on first startup, but you can also run them manually:

```bash
# Push the database schema
npm run db:push

# If there are warnings, force the push
npm run db:push --force
```

**Note**: See [DATABASE_SETUP.md](DATABASE_SETUP.md) for detailed database setup instructions and troubleshooting.

## Quick Start

### Option 1: Using Docker Compose (Recommended)

1. **Create environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` with your credentials:**
   ```env
   DATABASE_URL=postgresql://people:people812@pbe.im:3306/people_crm
   SESSION_SECRET=your-random-secret-key-here
   NODE_ENV=development
   S3_ENDPOINT=https://hel1.your-objectstorage.com
   S3_BUCKET=your-bucket-name
   S3_ACCESS_KEY=your-access-key
   S3_SECRET_KEY=your-secret-key
   ```

3. **Build and run:**
   ```bash
   docker-compose up -d
   ```

4. **Access the application:**
   Open your browser to `http://localhost:5000`

### Option 2: Using Docker CLI

1. **Build the image:**
   ```bash
   docker build -t people-manager-crm .
   ```

2. **Run the container:**
   ```bash
   docker run -d \
     --name people-manager \
     -p 5000:5000 \
     --env-file .env \
     people-manager-crm
   ```

3. **Access the application:**
   Open your browser to `http://localhost:5000`

## Management Commands

### Docker Compose

```bash
# Start the container
docker-compose up -d

# Stop the container
docker-compose down

# View logs
docker-compose logs -f

# Restart the container
docker-compose restart

# Rebuild and restart
docker-compose up -d --build
```

### Docker CLI

```bash
# View logs
docker logs -f people-manager

# Stop the container
docker stop people-manager

# Start the container
docker start people-manager

# Remove the container
docker rm -f people-manager

# View container status
docker ps
```

## Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection string | `postgresql://user:pass@host:port/db` |
| `SESSION_SECRET` | Yes | Secret key for session encryption | Generate with `openssl rand -base64 32` |
| `NODE_ENV` | Yes | Node environment | `development` or `production` |
| `S3_ENDPOINT` | Yes | S3-compatible storage endpoint | `https://hel1.your-objectstorage.com` |
| `S3_BUCKET` | Yes | S3 bucket name | `peoplewild` |
| `S3_ACCESS_KEY` | Yes | S3 access key | Your S3 access key |
| `S3_SECRET_KEY` | Yes | S3 secret key | Your S3 secret key |
| `DISABLE_AUTH` | No | Disable authentication (dev only) | `true` or `false` |

## Security Notes

1. **Never commit `.env` files** - They contain sensitive credentials
2. **Generate a strong SESSION_SECRET** - Use: `openssl rand -base64 32`
3. **Use HTTPS in production** - Place behind a reverse proxy like nginx
4. **Keep database credentials secure** - Use environment variables, never hardcode

## Troubleshooting

### "database does not exist" Error

If you see this error:
```
Error checking setup status: error: database "people_crm" does not exist
```

**Cause**: The PostgreSQL database hasn't been created yet.

**Solution**:

1. Create the database using the setup script:
   ```bash
   chmod +x setup-database.sh
   ./setup-database.sh
   ```

2. Or create it manually:
   ```bash
   psql -h pbe.im -p 3306 -U people -d postgres -c "CREATE DATABASE people_crm;"
   ```

3. Run database migrations:
   ```bash
   npm run db:push
   ```

4. Restart Docker:
   ```bash
   docker-compose restart
   ```

See [DATABASE_SETUP.md](DATABASE_SETUP.md) for detailed instructions.

### Container won't start
```bash
# Check logs
docker-compose logs
# or
docker logs people-manager
```

### "Cannot find package 'vite'" Error

If you see this error:
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vite' imported from /app/dist/index.js
```

**Cause**: This happens when `NODE_ENV` doesn't match the Dockerfile being used.

**Solution**:
- For `NODE_ENV=development` → Use `Dockerfile` (default)
- For `NODE_ENV=production` → Use `Dockerfile.production`

Update `docker-compose.yml` if using production:
```yaml
services:
  people-manager:
    build:
      dockerfile: Dockerfile.production  # Add this line
```

Or rebuild without cache:
```bash
docker-compose build --no-cache
docker-compose up
```

### Database connection issues
- Verify `DATABASE_URL` is correct
- Ensure the database server allows connections from your Docker host
- Check network connectivity to `pbe.im:3306`

### S3 Upload Issues

If image uploads fail:
1. Verify all S3 environment variables are set correctly
2. Check that your S3 bucket exists and is accessible
3. Ensure the bucket has proper permissions for uploads
4. Test S3 credentials outside Docker first

### Port already in use
If port 5000 is taken, edit `docker-compose.yml`:
```yaml
ports:
  - "3000:5000"  # Use port 3000 instead
```

## Production Deployment

For production deployments:

1. Use a reverse proxy (nginx, Traefik) for HTTPS
2. Set up proper logging and monitoring
3. Configure automatic restarts with `restart: always`
4. Implement proper backup strategies for your database
5. Use secrets management (Docker secrets, HashiCorp Vault, etc.)

## Health Check

The container includes a health check that runs every 30 seconds:
```bash
# Check health status
docker inspect --format='{{.State.Health.Status}}' people-manager
```

## Docker Files Explained

This project includes two Dockerfile options:

### `Dockerfile` (Development - Default)
- **Use when**: `NODE_ENV=development`
- **Features**:
  - Runs development server with hot reload
  - Includes all dependencies (dev + production)
  - Faster to build, larger image size (~500MB)
  - Source code mounted as volume for live updates
- **Best for**: Development, testing, debugging

### `Dockerfile.production` (Production)
- **Use when**: `NODE_ENV=production`
- **Features**:
  - Multi-stage build for optimized image
  - Only production dependencies
  - Pre-built, bundled application
  - Smaller image size (~200MB)
  - Non-root user for security
- **Best for**: Production deployments, staging environments

To use the production Dockerfile, update `docker-compose.yml`:
```yaml
services:
  people-manager:
    build:
      dockerfile: Dockerfile.production
```

## Build Details

The production Dockerfile uses a **multi-stage build**:
- **Stage 1 (builder)**: Installs dependencies and builds the application
- **Stage 2 (production)**: Creates minimal runtime image with only production dependencies

This results in a smaller, more secure production image.
