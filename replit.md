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

-   **Global Search:** Top-bar search with real-time dropdown results for people and groups, replacing a dedicated search page.
-   **Settings Page:** Dedicated `/settings` route with user profile editing (name, nickname, username, password change) and a placeholder for app-wide settings.
-   **First-Time Setup:** A `/welcome` route guides initial user creation when no users exist, with an API to check and initialize setup status.
-   **Graph Visualization:** Interactive graph displaying people and groups as draggable nodes using Pixi.js. Features include an `OptionsPanel` for controlling visibility of group nodes, a user highlight feature to focus on specific connections, and adjustable physics sliders for graph behavior.
-   **Relationship Types:** Customizable relationship types (e.g., Acquaintance, Friend) with names, colors, and notes, integrated into relationships and graph visualization.
-   **Deletion Features:** Comprehensive delete functionality for people and groups, including confirmation dialogs, cascade deletion of related data (notes, interactions, relationships), and toast notifications.
-   **API Documentation:** Collapsible, interactive API documentation with example code and copy functionality.

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