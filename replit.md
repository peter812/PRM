# People Management CRM Application

## Overview

This project is a professional CRM application for managing contacts, tracking interactions, and nurturing relationships. It features a modern React frontend and an Express backend, offering a clean, data-focused interface. Key capabilities include managing people profiles, notes, interactions (meetings, calls, emails), organizing contacts with tags, creating and managing groups, and utilizing global search functionalities. The application aims to provide a robust solution for personal and professional relationship management.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend

The frontend uses React 18+ with TypeScript, Vite, Wouter for routing, and shadcn/ui (New York style) built on Radix UI and Tailwind CSS for UI components. State management uses TanStack React Query for server data and React Hook Form with Zod for form validation.

### Backend

The backend is an Express.js application in TypeScript, providing a RESTful API for CRUD operations on people, notes, interactions, relationships, groups, and images. It uses Zod for validation, Multer for image uploads, and integrates Vite middleware for HMR.

### Data Storage

An external PostgreSQL database is used for all persistent data, configured via `DATABASE_URL`. Drizzle ORM handles type-safe database queries and migrations. Session-based authentication uses `express-session` with a PostgreSQL session store.

### Authentication & API Access

The application supports session-based authentication for the internal web UI and API key-based access for external integrations. API keys are hashed and managed via a settings page, never included in data exports. User creation is disabled by default after initial setup and can be re-enabled after a database reset.

**External API Documentation**: See `PRM-external-API-guide.md` for comprehensive documentation of all REST API endpoints available for third-party integrations.

### Database Reset

The "Reset Database" feature performs a complete wipe of all data including the current ME user. After reset:
- All tables are dropped and recreated
- Default relationship and interaction types are seeded
- No users are preserved (including the current ME user)
- User creation is re-enabled
- The current session is destroyed
- User is redirected to /welcome to create a new account

### Key Features & Design Decisions

-   **Global Search:** Real-time top-bar search with prioritized results for people and groups.
-   **People List Optimization:** Infinite scroll pagination loading 30 people at a time. People are sorted by highest-value relationship with the ME user first (e.g., Partners before Friends), then alphabetically by name. Each person card displays a colored badge showing their highest-value relationship type with the ME user. Only relationships between the displayed person and the ME user are considered for sorting and badge display.
-   **Graph Optimization:** Dedicated `/api/graph` endpoint for efficient data fetching, using Pixi.js for stable, WebGL-based interactive rendering with manual control to prevent race conditions.
-   **Graph Display Options:** Toggles for showing groups, disabling person lines, hiding orphans, and anonymizing people.
-   **Context-Aware Navigation:** Back buttons preserve navigation context.
-   **Settings Page:** Dedicated route for user profile and app-wide settings.
-   **First-Time Setup:** `/welcome` route guides initial user creation; automatic database initialization on startup if no users exist.
-   **Unified Relationship System:** Customizable, bidirectional person-to-person relationships with database-driven types, colors, and notes. Default types are provided.
-   **Deletion Features:** Comprehensive cascade deletion for people and groups.
-   **Groups Management:** Bidirectional member management between people and groups with various UI display modes.
-   **Editable Relationships & Interactions:** Modal dialogs for editing relationship types/notes and interaction details directly from person profiles.
-   **ME User in Interactions:** The ME user appears first in people selection lists when creating or editing interactions.
-   **XML Import/Export:** Full data backup and migration, preserving UUIDs, excluding images.
-   **API Documentation & Playground:** Interactive API documentation organized into collapsible sections (People, Notes, Interactions, Relationships, Groups, Group Notes) with endpoint details, request/response examples, and copy-to-clipboard functionality. Dedicated testing page at `/api-playground` with resource/operation selection, live code examples, and result execution.

### Interactions System

Supports multi-person and optional group contexts. Interactions store `peopleIds` (minimum 2), optional `groupIds`, type, date, description, and an optional `imageUrl`. Image attachments are stored in S3-compatible storage. Features include cascade deletion and smart cache invalidation. UI components facilitate adding interactions with multi-select and image upload, and a timeline visualization on profiles.

### Relationship System

Uses `relationship_types` for customizable types (UUID, name, color, notes) and `relationships` for person-to-person connections (`fromPersonId`, `toPersonId`, `typeId`, notes). Relationships are stored once but displayed bidirectionally on both people's profiles. UI components include `AddRelationshipDialog` for creating relationships and `RelationshipsTab` for display, with colors used in the graph visualization.

## External Dependencies

**Database:**
-   External PostgreSQL database.

**Image Storage:**
-   S3-compatible object storage.
-   AWS SDK S3 client.
-   `react-easy-crop` for client-side cropping.

**UI Component Libraries:**
-   Radix UI primitives.
-   `shadcn/ui`.
-   Lucide React for icons.

**Form & Validation:**
-   React Hook Form.
-   Zod.
-   `@hookform/resolvers` for Zod.

**Date Handling:**
-   `date-fns`.

**Styling:**
-   Tailwind CSS.
-   `class-variance-authority`, `clsx`, `tailwind-merge`.

**UI Enhancement:**
-   `cmdk` (command palette).
-   `embla-carousel-react`.
-   `vaul` (drawers).

**Graph Visualization:**
-   Pixi.js.

**File Upload:**
-   Multer.