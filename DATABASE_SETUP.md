# Database Setup Guide

The People Manager CRM requires a PostgreSQL database. This guide will help you set it up.

## Automatic Database Reset (New!)

🎯 **The application now automatically resets the database when there are no users!**

When you start the application:
- ✅ If **users exist**: Normal startup, no changes to database
- 🔄 If **no users exist**: Automatically drops all tables and recreates them from schema

This means:
- First-time setup is automatic - just create the database and start the app!
- You can reset your database by deleting all users
- Great for development and testing

**How it works:**
1. App starts → Checks for users in database
2. No users found → Drops all tables → Runs migrations → Seeds default data
3. Users found → Skips initialization, normal startup

## Quick Setup

### Option 1: Using the Setup Script (Recommended)

Run the provided setup script to automatically create the database:

```bash
# Make the script executable
chmod +x setup-database.sh

# Run the script
./setup-database.sh
```

The script will:
1. Check if the database exists
2. Create it if it doesn't exist
3. Show you the next steps

### Option 2: Manual Setup

If you prefer to set up manually:

#### 1. Connect to PostgreSQL

```bash
psql -h pbe.im -p 3306 -U people -d postgres
```

When prompted, enter the password: `people812`

#### 2. Create the Database

```sql
CREATE DATABASE people_crm;
```

#### 3. Verify the Database

```sql
\l people_crm
```

You should see `people_crm` in the list.

#### 4. Exit psql

```sql
\q
```

### Option 3: Using a Different Database Name

If you want to use a different database name that already exists on your server:

1. Update your `.env` file with the correct database name:
   ```env
   DATABASE_URL=postgresql://people:people812@pbe.im:3306/your_existing_database
   ```

2. Make sure the database exists on the server

## Running Database Migrations

After creating the database, you need to push the schema:

```bash
# Push the schema to the database
npm run db:push

# If there are warnings about data loss, force the push
npm run db:push --force
```

This will create all the necessary tables:
- `users` - User accounts
- `people` - Contact profiles
- `notes` - Notes attached to people
- `interactions` - Meetings, calls, emails
- `relationships` - Person-to-person connections
- `relationship_types` - Types of relationships (friend, family, etc.)
- `groups` - Contact groups
- `group_notes` - Notes for groups
- `session` - Session storage

## Verifying Setup

After running migrations, verify the tables were created:

```bash
psql -h pbe.im -p 3306 -U people -d people_crm -c "\dt"
```

You should see all the tables listed.

## Running the Application

Once the database is set up and migrations are complete:

### Local Development
```bash
npm run dev
```

### Docker
```bash
docker-compose up
```

The application will be available at `http://localhost:5000`

## Troubleshooting

### "database does not exist" Error

If you see this error:
```
error: database "people_crm" does not exist
```

**Solution**: The database hasn't been created yet. Follow the setup instructions above.

### "permission denied to create database"

If you get a permission error when trying to create the database:

1. Contact your database administrator
2. Or use a database that already exists
3. Update the `DATABASE_URL` in `.env` to point to an existing database

### "Connection refused" or "could not connect"

If you can't connect to the database:

1. Verify the host is accessible:
   ```bash
   ping pbe.im
   ```

2. Check if the port is correct (PostgreSQL usually uses 5432, but this setup uses 3306)

3. Verify firewall settings allow connections to port 3306

4. Try connecting with psql manually:
   ```bash
   psql -h pbe.im -p 3306 -U people -d postgres
   ```

### Tables Already Exist

If you run `npm run db:push` and get errors about existing tables:

```bash
# Force push the schema (this will drop existing tables!)
npm run db:push --force
```

⚠️ **Warning**: This will delete all existing data in the tables!

## Database Connection String Format

The connection string format is:
```
postgresql://username:password@host:port/database
```

For this setup:
```
postgresql://people:people812@pbe.im:3306/people_crm
```

Components:
- **Protocol**: `postgresql://`
- **Username**: `people`
- **Password**: `people812`
- **Host**: `pbe.im`
- **Port**: `3306` (non-standard for PostgreSQL)
- **Database**: `people_crm`

## Security Notes

1. **Never commit your `.env` file** - It contains database credentials
2. **Change default passwords** - The example password should be changed for production
3. **Use SSL/TLS** - For production, ensure your database connection uses SSL
4. **Restrict database access** - Only allow connections from trusted IPs

## Docker-Specific Setup

If running in Docker, you have two options:

### Option A: Create Database Before Starting Docker

1. Create the database using the setup script or manually
2. Run migrations: `npm run db:push`
3. Start Docker: `docker-compose up`

### Option B: Create Database from Inside Docker

1. Start the container (it will fail initially):
   ```bash
   docker-compose up -d
   ```

2. Access the container shell:
   ```bash
   docker-compose exec people-manager sh
   ```

3. Install PostgreSQL client:
   ```bash
   apk add postgresql-client
   ```

4. Create the database:
   ```bash
   PGPASSWORD=people812 psql -h pbe.im -p 3306 -U people -d postgres -c "CREATE DATABASE people_crm;"
   ```

5. Run migrations:
   ```bash
   npm run db:push
   ```

6. Restart the container:
   ```bash
   docker-compose restart
   ```

## Next Steps

After successful database setup:

1. ✅ Database created
2. ✅ Migrations run (`npm run db:push`)
3. ✅ Application started
4. 🎉 Visit `http://localhost:5000` and complete the first-time setup!

The application will guide you through creating your first user account and setting up the system.
