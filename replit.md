# People Management CRM Application

## Overview

A professional CRM application for managing contacts, tracking interactions, and maintaining relationships. Built with a modern React frontend and Express backend, the application provides a clean, data-focused interface inspired by productivity tools like Linear and Notion. Users can create and manage people profiles, add notes, track interactions (meetings, calls, emails), organize contacts with tags, create groups with members, and use powerful search capabilities.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework & Build System:**
- React 18+ with TypeScript for type-safe component development
- Vite as the build tool and development server with HMR support
- Wouter for lightweight client-side routing (not React Router)

**UI Component System:**
- shadcn/ui component library (New York style) with Radix UI primitives
- Tailwind CSS for styling with custom design tokens
- CSS variables for theming with light/dark mode support
- Component architecture follows atomic design principles with reusable UI components in `/client/src/components/ui`

**State Management:**
- TanStack React Query (v5) for server state management and data fetching
- Query client configured with optimistic UI updates and cache invalidation
- Custom API request wrapper handling fetch operations and error states
- Form state managed with React Hook Form and Zod validation

**Design System:**
- Typography: Inter (primary), JetBrains Mono (monospace for technical data)
- Spacing based on Tailwind's 2/4/6/8/12/16 unit scale
- Custom color system with HSL-based CSS variables for theming
- Border radius customization: lg (9px), md (6px), sm (3px)

### Backend Architecture

**Server Framework:**
- Express.js with TypeScript for REST API endpoints
- Module system using ES modules (type: "module")
- Middleware: JSON body parsing with raw body preservation, CORS handling

**API Structure:**
- RESTful endpoints under `/api` prefix:
  - `/api/people` - CRUD operations for contacts (with image support)
  - `/api/notes` - Note management for people (with image support)
  - `/api/interactions` - Interaction tracking (meetings, calls, emails, with image support)
  - `/api/relationships` - Relationship management between people
  - `/api/groups` - CRUD operations for groups (with image support)
  - `/api/group-notes` - Note management for groups
  - `/api/upload-image` - Image upload endpoint (multipart/form-data)
  - `/api/delete-image` - Image deletion endpoint for S3 cleanup
- Route handlers in `server/routes.ts` with validation using Zod schemas
- Business logic abstracted into storage layer (`server/storage.ts`)
- Image uploads handled by multer middleware with in-memory storage

**Development Environment:**
- Vite middleware mode integration for development with HMR
- Static file serving in production build
- Request logging with timing metrics for API routes
- Error handling with structured error responses

### Data Storage Solutions

**Database:**
- PostgreSQL database via Neon serverless driver
- Connection pooling for performance optimization
- WebSocket support for serverless connections

**ORM & Schema:**
- Drizzle ORM for type-safe database queries and migrations
- Schema-first approach with TypeScript types generated from database schema
- Database tables:
  - `users`: Authentication (username, password)
  - `people`: Contact information (name, email, phone, company, title, tags, imageUrl)
  - `notes`: Text notes associated with people (imageUrl support)
  - `interactions`: Tracked interactions with type (meeting/call/email/other), date, description (imageUrl support)
  - `relationships`: Connections between people with relationship levels
  - `groups`: Group information (name, color, type, members list, imageUrl)
  - `group_notes`: Text notes associated with groups
- Foreign key relationships with cascade deletion
- Array type support for tags on people, group types, and group members
- Image URLs stored as text references to S3-hosted images

**Data Validation:**
- Drizzle-Zod integration for runtime validation
- Shared schema definitions between frontend and backend (`shared/schema.ts`)
- Insert schemas for create operations, full schemas for read operations

### Authentication and Authorization

Session-based authentication implemented using express-session with PostgreSQL session store. Login required to access the application - sidebar hidden on login page. Registration is disabled. Current authentication is single-user based.

## External Dependencies

**Database Service:**
- Neon PostgreSQL serverless database
- Connection via `DATABASE_URL` environment variable
- WebSocket protocol for serverless compatibility

**Image Storage:**
- S3-compatible object storage (hel1.your-objectstorage.com)
- Image upload with client-side cropping using react-easy-crop
- Images stored in S3 bucket (zeropeople) with unique filenames
- AWS SDK S3 client for upload/delete operations
- Environment variables: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY
- Multer middleware for handling multipart/form-data uploads

**UI Component Libraries:**
- Radix UI primitives for accessible component foundations
- Multiple Radix components: Dialog, Dropdown, Popover, Tabs, Toast, Select, etc.
- Lucide React for icon system

**Development Tools:**
- Replit-specific plugins for development banner and error overlay
- Cartographer for development environment integration (Replit-specific)

**Form & Validation:**
- React Hook Form for form state management
- Zod for schema validation and TypeScript type inference
- @hookform/resolvers for Zod integration

**Date Handling:**
- date-fns for date formatting and manipulation
- Used in interaction tracking and timestamp display

**Styling:**
- PostCSS with Tailwind CSS and Autoprefixer
- class-variance-authority for component variant management
- clsx and tailwind-merge for conditional class composition

**UI Enhancement:**
- cmdk for command palette functionality
- embla-carousel-react for carousel components
- vaul for drawer components
- react-easy-crop for client-side image cropping with zoom controls

**File Upload:**
- Multer for handling multipart/form-data file uploads
- In-memory buffer storage for temporary file handling
- AWS SDK (@aws-sdk/client-s3, @aws-sdk/s3-request-presigner) for S3 operations