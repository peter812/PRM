# People Manager CRM - Development Quick Start

Get your development environment up and running quickly on any platform.

## Prerequisites

Before you begin, ensure you have the following installed:

| Tool | Version | Download |
|------|---------|----------|
| **Node.js** | v18+ (v20 recommended) | [nodejs.org](https://nodejs.org/) |
| **npm** | v9+ (comes with Node.js) | Included with Node.js |
| **Git** | Latest | [git-scm.com](https://git-scm.com/) |
| **PostgreSQL** | v14+ | See Database Options below |

### Optional Tools

| Tool | Purpose |
|------|---------|
| **Docker Desktop** | Alternative database setup, production testing |
| **VS Code** | Recommended IDE |

---

## Quick Start (5 Minutes)

### Step 1: Clone and Install

```bash
# Clone the repository
git clone https://github.com/your-username/people-manager-crm.git
cd people-manager-crm

# Install dependencies
npm install
```

### Step 2: Choose Your Development Method

**Option A: Full Docker Stack (Easiest)**
```bash
# Start both database and app
docker-compose -f docker-compose.dev.yml up -d
```
Open **http://localhost:5001** - Done!

**Option B: Native Development (Best for coding)**
```bash
# Start database only
docker-compose -f docker-compose.dev.yml up -d postgres

# Copy environment template
cp .env.example .env

# Push database schema
npm run db:push

# Start development server
npm run dev
```
Open **http://localhost:5000**

On first visit, you'll be guided through creating your admin account.

---

## Database Options

Choose one of these options based on your preference:

### Option A: Docker PostgreSQL (Recommended for Beginners)

The easiest way to get a database running locally:

```bash
# Start PostgreSQL in Docker
docker-compose -f docker-compose.dev.yml up -d postgres

# Your .env DATABASE_URL should be:
# DATABASE_URL=postgresql://prm:prm_dev_password@localhost:5432/people_crm
```

To stop the database:
```bash
docker-compose -f docker-compose.dev.yml down
```

### Option B: Local PostgreSQL Installation

**macOS (Homebrew):**
```bash
brew install postgresql@15
brew services start postgresql@15
createdb people_crm
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo -u postgres createuser --interactive
sudo -u postgres createdb people_crm
```

**Windows:**
1. Download from [postgresql.org](https://www.postgresql.org/download/windows/)
2. Run the installer
3. Use pgAdmin or command line to create a database named `people_crm`

Update your `.env` with your local connection:
```env
DATABASE_URL=postgresql://your_username:your_password@localhost:5432/people_crm
```


Copy the connection string to your `.env`.

---

## IDE Setup

### VS Code (Recommended)

**Recommended Extensions:**
- **ESLint** - Code linting
- **Prettier** - Code formatting
- **TypeScript and JavaScript Language Features** - Built-in
- **Tailwind CSS IntelliSense** - CSS class autocomplete
- **Prisma** or **Drizzle ORM** - Database schema highlighting

**Workspace Settings** (`.vscode/settings.json`):
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "typescript.preferences.importModuleSpecifier": "relative"
}
```

### Other IDEs

The project works with any IDE that supports TypeScript:
- **WebStorm** - Full support out of the box
- **Vim/Neovim** - Use coc.nvim or nvim-lspconfig with typescript-language-server
- **Sublime Text** - Use LSP package with typescript server

---

## Development Workflow

### Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build for production |
| `npm run start` | Run production build |
| `npm run check` | TypeScript type checking |
| `npm run db:push` | Push schema changes to database |
| `npm run db:studio` | Open Drizzle Studio (database viewer) |

### Project Structure

```
people-manager-crm/
├── client/              # React frontend
│   └── src/
│       ├── components/  # Reusable UI components
│       ├── pages/       # Page components
│       ├── hooks/       # Custom React hooks
│       └── lib/         # Utilities and helpers
├── server/              # Express backend
│   ├── index.ts         # Server entry point
│   ├── routes.ts        # API routes
│   └── storage.ts       # Database operations
├── shared/              # Shared code (frontend + backend)
│   └── schema.ts        # Database schema (Drizzle ORM)
└── .env                 # Environment variables (not in git)
```

### Making Changes

1. **Frontend changes**: Edit files in `client/src/` - hot reload will update the browser
2. **Backend changes**: Edit files in `server/` - server will auto-restart
3. **Database changes**: Edit `shared/schema.ts`, then run `npm run db:push`

---

## Docker Development Stack

The `docker-compose.dev.yml` provides a complete development environment:

| Service | Container | Port | Description |
|---------|-----------|------|-------------|
| **App** | prm-app-dev | 5001 | PRM application |
| **Database** | prm-postgres-dev | 5432 | PostgreSQL 15 |

**Commands:**
```bash
# Start everything
docker-compose -f docker-compose.dev.yml up -d

# Start database only (for native app development)
docker-compose -f docker-compose.dev.yml up -d postgres

# View logs
docker-compose -f docker-compose.dev.yml logs -f

# Stop everything
docker-compose -f docker-compose.dev.yml down

# Reset database (removes all data)
docker-compose -f docker-compose.dev.yml down -v
```

**Note:** The Docker app runs on port 5001 to avoid conflicts with native development on port 5000.

## Production Deployment

For production deployment with Docker, see [DOCKER.md](DOCKER.md) which uses `docker-compose.yml` with an external database.

---

## Common Issues

### "database does not exist"

Create the database first:
```bash
# Docker option
docker-compose -f docker-compose.dev.yml up -d postgres

# Or manually with psql
createdb people_crm
```

### "relation does not exist"

Push the schema to your database:
```bash
npm run db:push -- --force
```

### "ENOENT: no such file or directory .env"

Create the environment file:
```bash
cp .env.example .env
```

### Windows: "NODE_ENV is not recognized"

The development server should work without manually setting NODE_ENV. If you encounter issues, use PowerShell:
```powershell
$env:NODE_ENV="development"; npm run dev
```

Or use Command Prompt:
```cmd
set NODE_ENV=development && npm run dev
```

### Port 5000 already in use

Change the port or stop the conflicting process:
```bash
# Linux/macOS: Find and kill process
lsof -i :5000
kill -9 <PID>

# Windows PowerShell
netstat -ano | findstr :5000
taskkill /PID <PID> /F
```

### Images don't upload

Configure S3 storage in `.env`. For development without image uploads, you can leave S3 settings empty - the app will function but image uploads will fail.

---

## Next Steps

Once running:

1. Complete the first-time setup wizard
2. Add your first contact
3. Explore relationship types in Settings
4. Try the 2D and 3D relationship graphs
5. Check the API documentation at `/api-playground`

---

## Additional Documentation

- **[DOCKER.md](DOCKER.md)** - Production Docker deployment
- **[DATABASE_SETUP.md](DATABASE_SETUP.md)** - Advanced database configuration
- **[PRM-external-API-guide.md](PRM-external-API-guide.md)** - REST API documentation

---

Happy developing!
