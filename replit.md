# People Management CRM Application

## Overview

A professional CRM application for managing contacts, tracking interactions, and maintaining relationships. Built with a modern React frontend and Express backend, the application provides a clean, data-focused interface inspired by productivity tools like Linear and Notion. Users can create and manage people profiles, add notes, track interactions (meetings, calls, emails), and organize contacts with tags and search capabilities.

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
  - `/api/people` - CRUD operations for contacts
  - `/api/notes` - Note management for people
  - `/api/interactions` - Interaction tracking (meetings, calls, emails)
- Route handlers in `server/routes.ts` with validation using Zod schemas
- Business logic abstracted into storage layer (`server/storage.ts`)

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
- Three main tables:
  - `people`: Contact information (name, email, phone, company, title, tags)
  - `notes`: Text notes associated with people
  - `interactions`: Tracked interactions with type (meeting/call/email/other), date, description
- Foreign key relationships with cascade deletion
- Array type support for tags on people

**Data Validation:**
- Drizzle-Zod integration for runtime validation
- Shared schema definitions between frontend and backend (`shared/schema.ts`)
- Insert schemas for create operations, full schemas for read operations

### Authentication and Authorization

Currently not implemented - application operates without user authentication. All data is accessible to anyone with access to the application.

## External Dependencies

**Database Service:**
- Neon PostgreSQL serverless database
- Connection via `DATABASE_URL` environment variable
- WebSocket protocol for serverless compatibility

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