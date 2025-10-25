# Docker Deployment Guide

This guide explains how to run the People Manager CRM in a Docker container.

## Prerequisites

- Docker installed on your system
- Docker Compose installed (optional, but recommended)
- Access to the PostgreSQL database at `pbe.im:3306`

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
   NODE_ENV=production
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
     -e DATABASE_URL="postgresql://people:people812@pbe.im:3306/people_crm" \
     -e SESSION_SECRET="your-random-secret-key-here" \
     -e NODE_ENV=production \
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

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:port/db` |
| `SESSION_SECRET` | Secret key for session encryption | Generate with `openssl rand -base64 32` |
| `NODE_ENV` | Node environment (always use `production`) | `production` |

## Security Notes

1. **Never commit `.env` files** - They contain sensitive credentials
2. **Generate a strong SESSION_SECRET** - Use: `openssl rand -base64 32`
3. **Use HTTPS in production** - Place behind a reverse proxy like nginx
4. **Keep database credentials secure** - Use environment variables, never hardcode

## Troubleshooting

### Container won't start
```bash
# Check logs
docker-compose logs
# or
docker logs people-manager
```

### Database connection issues
- Verify `DATABASE_URL` is correct
- Ensure the database server allows connections from your Docker host
- Check network connectivity to `pbe.im:3306`

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

## Build Details

The Dockerfile uses a **multi-stage build**:
- **Stage 1 (builder)**: Installs dependencies and builds the application
- **Stage 2 (production)**: Creates minimal runtime image with only production dependencies

This results in a smaller, more secure production image.
