# People Management CRM Application

## Overview

This project is a professional CRM application designed for managing contacts, tracking interactions, and nurturing relationships. It features a modern React frontend and an Express backend, offering a clean, data-focused interface inspired by productivity tools. Key capabilities include creating and managing people profiles, adding notes, tracking interactions (meetings, calls, emails), organizing contacts with tags, creating and managing groups with members, and utilizing powerful global search functionalities. The application aims to provide a robust solution for personal and professional relationship management.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

The frontend is built with React 18+ and TypeScript, utilizing Vite for development and bundling. Wouter handles client-side routing. UI components are developed using shadcn/ui (New York style) built on Radix UI primitives, styled with Tailwind CSS and custom design tokens for theming and light/dark mode support. State management for server data is handled by TanStack React Query, with React Hook Form and Zod for form state and validation. Typography uses Inter and JetBrains Mono.

### Backend Architecture

The backend is an Express.js application written in TypeScript, providing a RESTful API. Endpoints cover CRUD operations for people, notes, interactions, relationships, groups, and image uploads/deletions. Route handlers in `server/routes.ts` use Zod for validation, with business logic abstracted to `server/storage.ts`. Multer is used for handling image uploads. The development environment integrates Vite middleware for HMR, and the API includes request logging and structured error handling.

### Data Storage Solutions

The application uses an **external PostgreSQL database** (pbe.im:3306) for all persistent data, configured via the `DATABASE_URL` environment variable. Drizzle ORM provides type-safe database queries and migrations, following a schema-first approach. Key tables include `users`, `people`, `notes`, `interactions`, `relationships`, `relationship_types`, `groups`, `group_notes`, and `session`. Foreign key relationships with cascade deletion and array type support are utilized. Drizzle-Zod is used for runtime data validation, sharing schema definitions between frontend and backend. Session-based authentication is implemented using `express-session` with a PostgreSQL session store.

### Key Features & Design Decisions

-   **Global Search:** Top-bar search with real-time dropdown results for people and groups, replacing a dedicated search page. Search results are intelligently prioritized: matches at the start of first names appear first, followed by matches at the start of last names, then matches found elsewhere (email, company, tags). Within each priority level, results are sorted alphabetically by the matched field.
-   **Graph Optimization:** The graph visualization uses a dedicated `/api/graph` endpoint that fetches only minimal data required for rendering (id, firstName, lastName, company for people; id, fromPersonId, toPersonId, typeColor for relationships; id, name, color, members for groups). This eliminates the previous N+1 query pattern and significantly improves performance. The frontend uses dedicated minimal types (`GraphPerson`, `GraphRelationship`, `GraphGroup`) to maintain type safety while reducing data transfer.
-   **Hide Orphans:** The graph page includes a toggle to hide people with no connections. When enabled, only people who have at least one relationship with another person OR are members of a group are displayed. This feature helps focus on the connected network and reduce visual clutter.
-   **Enhanced Add Connection Dialog:** The graph page's "Add Connection" dialog features searchable autocomplete fields for selecting both people and relationship types. It fetches relationship types dynamically from the database, displays color indicators for each type, and prevents self-connections by clearing the second person field when the first person selection changes.
-   **Settings Page:** Dedicated `/settings` route with user profile editing (name, nickname, username, password change) and a placeholder for app-wide settings.
-   **First-Time Setup:** A `/welcome` route guides initial user creation when no users exist, with an API to check and initialize setup status.
-   **Automatic Database Initialization:** On application startup, the system checks if any users exist. If no users are found, it automatically drops all database tables, runs migrations to recreate them from the schema, and seeds default relationship types. This ensures a clean state for first-time setup or development resets.
-   **Unified Relationship System:** Person-to-person relationships use customizable relationship types from the database. Relationships are bidirectional - creating a relationship from Person A to Person B automatically makes it visible on both people's profiles. Relationship types include name, color (for UI/graph visualization), and optional notes. Default types include: Acquaintance (#10b981), Friend (#3b82f6), Good Friend (#8b5cf6), Best Friend (#ec4899), Colleague (#f59e0b), Family (#ef4444), and Partner (#06b6d4).
-   **Deletion Features:** Comprehensive delete functionality for people and groups, including confirmation dialogs, cascade deletion of related data (notes, interactions, relationships), and toast notifications.
-   **API Documentation:** Collapsible, interactive API documentation with example code and copy functionality.

### Interactions System Architecture

The application uses a flexible interactions system that supports multi-person and group contexts:

**Database Schema:**
- `interactions`: Stores interactions with `peopleIds` array (minimum 2 required), optional `groupIds` array, type, date, description, and optional `imageUrl`
- Interactions can involve multiple people (e.g., team meetings, group calls) and link to zero or more groups
- Image attachments are stored in S3-compatible object storage with automatic CDN cleanup on deletion

**Key Features:**
- **Multi-Person Support:** Each interaction requires at least 2 people, enabling tracking of group meetings, calls, and collaborative events
- **Optional Group Association:** Interactions can be linked to one or more groups, making them visible on group profile pages
- **Image Attachments:** Upload and attach images to interactions with automatic S3 storage and cleanup on deletion
- **Cascade Deletion:** Removing a person or group automatically removes them from all associated interactions
- **Smart Cache Invalidation:** When an interaction is deleted, all affected person and group queries are invalidated to ensure UI consistency

**UI Components:**
- `AddInteractionDialog`: Multi-select interface for choosing people (minimum 2) and optional groups, with image upload support
- `InteractionsTab`: Displays interactions with all involved people and groups, used on both person and group profile pages
- Timeline visualization with type-specific icons and color coding for different interaction types (meeting, call, email, other)

**API Endpoints:**
- `POST /api/interactions`: Create interaction with multiple people, optional groups, and optional image
- `DELETE /api/interactions/:id`: Delete interaction and associated S3 image if present
- Interactions are included in both person and group detail endpoints

### Relationship System Architecture

The application uses a unified relationship system with the following components:

**Database Tables:**
- `relationship_types`: Stores customizable relationship types with UUID, name, color (hex), and optional notes
- `relationships`: Stores person-to-person connections with `fromPersonId`, `toPersonId`, `typeId` (foreign key), and optional notes

**Bidirectional Display:**
Relationships are stored once in the database but displayed on both people's profiles. The storage layer queries relationships in both directions:
1. Where the person is `fromPersonId` (outgoing relationships)
2. Where the person is `toPersonId` (incoming relationships)

This ensures mutual visibility - if Bob is friends with Ryan, the friendship appears on both Bob's and Ryan's profiles.

**UI Integration:**
- `AddRelationshipDialog`: Fetches relationship types from database and displays them with color indicators
- `RelationshipsTab`: Shows all bidirectional relationships with colored type badges
- `Graph Visualization`: Uses relationship type colors for edge rendering in the network graph

**API Endpoints:**
- `GET /api/relationship-types`: Fetch all relationship types
- `POST /api/relationships`: Create a new relationship (automatically bidirectional)
- `DELETE /api/relationships/:id`: Remove a relationship (affects both people)

## External Dependencies

**Database:**
-   External PostgreSQL database at `pbe.im:3306`.

**Image Storage:**
-   S3-compatible object storage (e.g., `hel1.your-objectstorage.com`) for images.
-   AWS SDK S3 client for upload/delete operations.
-   `react-easy-crop` for client-side image cropping.

**UI Component Libraries:**
-   Radix UI primitives for accessible components.
-   `shadcn/ui` for styled components.
-   Lucide React for icons.

**Development Tools:**
-   Replit-specific plugins (development banner, error overlay, Cartographer).

**Form & Validation:**
-   React Hook Form.
-   Zod for schema validation.
-   `@hookform/resolvers` for Zod integration.

**Date Handling:**
-   `date-fns` for date manipulation.

**Styling:**
-   Tailwind CSS with PostCSS.
-   `class-variance-authority`, `clsx`, and `tailwind-merge` for styling utilities.

**UI Enhancement:**
-   `cmdk` for command palette.
-   `embla-carousel-react` for carousels.
-   `vaul` for drawer components.

**Graph Visualization:**
-   Pixi.js for WebGL-based interactive graph rendering.

**File Upload:**
-   Multer for handling multipart/form-data.