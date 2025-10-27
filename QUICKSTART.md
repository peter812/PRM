# Quick Start Guide

Get your People Manager CRM up and running in 5 minutes!

## Prerequisites

- Docker and Docker Compose installed
- PostgreSQL client (psql) for database setup
- Access to PostgreSQL server at `pbe.im:3306`
- S3 storage credentials

## Step-by-Step Setup

### 1. Clone and Configure

```bash
# Copy the environment template
cp .env.example .env

# Edit .env with your actual credentials
nano .env  # or use your preferred editor
```

Fill in these required values:
- `DATABASE_URL` - Your PostgreSQL connection string
- `SESSION_SECRET` - Generate with: `openssl rand -base64 32`
- `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` - Your S3 credentials

### 2. Create the Database

**Option A: Automated (Recommended)**
```bash
chmod +x setup-database.sh
./setup-database.sh
```

**Option B: Manual**
```bash
psql -h pbe.im -p 3306 -U people -d postgres -c "CREATE DATABASE people_crm;"
```

### 3. ✨ Automatic Database Setup (New!)

The application now **automatically sets up the database** when there are no users!

Just start the app - it will:
- ✅ Check if users exist
- ✅ If no users: Drop all tables and recreate them
- ✅ Seed default relationship types
- ✅ Ready to use!

**Manual migration (optional):**
If you prefer to run migrations manually before starting:

```bash
npm install
npm run db:push --force
```

### 4. Start the Application

**With Docker (Recommended):**
```bash
docker-compose up -d
```

**Or run locally:**
```bash
npm run dev
```

### 5. Access the Application

Open your browser to: **http://localhost:5000**

On first visit, you'll be guided through creating your admin account!

## What Gets Created

The database migration creates these tables:
- **users** - User accounts
- **people** - Your contacts
- **notes** - Notes for people
- **interactions** - Meetings, calls, emails
- **relationships** - Person-to-person connections
- **relationship_types** - Friend, family, colleague, etc.
- **groups** - Contact groups
- **group_notes** - Notes for groups
- **session** - Session storage

## Verify Everything Works

1. ✅ Application loads at http://localhost:5000
2. ✅ You can create a user account
3. ✅ You can add your first contact
4. ✅ Image uploads work (profile pictures)

## Common Issues

### "database does not exist"
**Fix**: Run the database setup script (Step 2 above)

### "Cannot find package 'vite'"
**Fix**: Make sure `NODE_ENV` in `.env` matches your Dockerfile:
- `NODE_ENV=development` → Use default `Dockerfile`
- `NODE_ENV=production` → Use `Dockerfile.production`

### "Connection refused"
**Fix**: Check your `DATABASE_URL` and verify the PostgreSQL server is accessible:
```bash
psql -h pbe.im -p 3306 -U people -d postgres
```

### Images won't upload
**Fix**: Verify all S3 environment variables are set correctly in `.env`

## Next Steps

Once running:

1. 🎨 Complete the first-time setup wizard
2. 👥 Add your contacts
3. 🏷️ Create relationship types (Settings → Relationship Types)
4. 📊 Explore the relationship graph
5. 📝 Add notes and track interactions

## Getting Help

- **Database Setup**: See [DATABASE_SETUP.md](DATABASE_SETUP.md)
- **Docker Issues**: See [DOCKER.md](DOCKER.md)
- **General Info**: See [README.md](README.md)

## Development Workflow

```bash
# View logs
docker-compose logs -f

# Restart after changes
docker-compose restart

# Stop everything
docker-compose down

# Rebuild from scratch
docker-compose build --no-cache
docker-compose up
```

## Production Deployment

When ready for production:

1. Change `.env`:
   ```env
   NODE_ENV=production
   ```

2. Update `docker-compose.yml`:
   ```yaml
   build:
     dockerfile: Dockerfile.production
   ```

3. Deploy:
   ```bash
   docker-compose build
   docker-compose up -d
   ```

---

**Questions?** Check the detailed guides in the repository or the troubleshooting sections.

Happy CRM-ing! 🚀
