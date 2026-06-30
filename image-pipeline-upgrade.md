# PRM Image Pipeline Upgrade Plan (PRM Application)

This plan outlines the enhancements required for the PRM application to build out the new image processing, facial recognition, and description pipeline. It details the database schema updates, backend API changes, and frontend UI components necessary to integrate with **PRM-face** and **Ollama**.

---

## 1. Database Schema Enhancements (Drizzle ORM)

We will modify `./shared/schema.ts` to add the required columns and tables for tracking face identifications, managing manual questions, and processing image tasks.

### 1.1 `photos` Table Update
We will add a new `facial_ids` column to store detailed face recognition metadata directly on the photo record.

```typescript
// Modify the photos table in ./shared/schema.ts
export const photos = pgTable("photos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  location: text("location").notNull(), 
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  isSubImage: boolean("is_sub_image").notNull().default(false),
  processedAt: timestamp("processed_at"),
  imageDescriptionAt: timestamp("image_description_at"),
  imageDescription: text("image_description"),
  faceIdAt: timestamp("face_id_at"),
  
  // NEW: Store structured face data
  // Array of:
  // {
  //   faceUuid: string,
  //   subImageUrl: string,
  //   coordinates: { x: number, y: number, w: number, h: number },
  //   personId: string | null,
  //   socialAccountId: string | null
  // }
  facialIds: jsonb("facial_ids").default(sql`'[]'::jsonb`),
  
  prmLocation: text("prm_location").notNull(), 
  metadata: jsonb("metadata"), 
  ogMetadata: jsonb("og_metadata"), 
  fileHash: text("file_hash"), 
  widthPx: integer("width_px"), 
  heightPx: integer("height_px"), 
  vectorId: text("vector_id"),
  vectorSyncedAt: timestamp("vector_synced_at"),
});
```

### 1.2 `image_questions` Table (New)
This table will track detected faces that cannot be confidently linked to a known person and require human manual intervention in the UI.

```typescript
// Add to ./shared/schema.ts
export const imageQuestions = pgTable("image_questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  photoId: varchar("photo_id")
    .notNull()
    .references(() => photos.id, { onDelete: "cascade" }),
  faceUuid: varchar("face_uuid").notNull(), // UUID of the face from PRM-face
  subImageUrl: text("sub_image_url").notNull(), // S3 URL to cropped cutout
  coordinates: jsonb("coordinates").notNull(), // { x: number, y: number, w: number, h: number }
  status: text("status").notNull().default("pending"), // 'pending' | 'resolved' | 'ignored'
  resolvedAs: text("resolved_as"), // 'known_person' | 'create_person' | 'unknown'
  resolvedPersonId: varchar("resolved_person_id")
    .references(() => people.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});
```

---

## 2. Backend API Changes (Express.js)

We need to enhance `server/routes/ai-vector.ts` to accommodate the connection variable handshake, settings synchronization, the background task workflow, and the interactive foreground modal.

### 2.0 Handshake & Connection Variable Sharing
When the PRM application performs the initial setup handshake with PRM-face to generate an API key (using the console `setup_code`):
1. **`POST /api/prm-face/generate-key`**:
   - PRM gathers its own database connection string and S3 connection credentials.
   - If running in Docker, PRM replaces localhost reference in database URL with Docker network hostname (e.g. `postgres`).
   - PRM sends these connection parameters to PRM-face inside the payload of the key exchange:
     - `setup_code`: Setup hex key from PRM-face console.
     - `label`: Name of the API key (e.g., `"prm-crm"`).
     - `database_url`: The database connection URL for PostgreSQL.
     - `s3_endpoint`: S3 server endpoint URL.
     - `s3_bucket`: S3 bucket name.
     - `s3_access_key`: S3 access key.
     - `s3_secret_key`: S3 secret key.
2. PRM-face processes the setup code, validates the connection parameters, writes them to its configuration, initializes its database engine/S3 client, and returns the generated API key.

### 2.0.1 Recognition Parameters Configuration API
To let the user modify recognition thresholds (e.g., maximum faces, minimum size, confidence):
- **`GET /api/prm-face/config`**:
  - PRM acts as a proxy, fetching the configuration from PRM-face via: `GET <prm-face-url>/api/face/config`.
  - Attaches the configured `X-API-Key` auth header.
  - Responds to the frontend with the active configuration parameters.
- **`POST /api/prm-face/config`**:
  - PRM proxies user changes from settings to PRM-face: `POST <prm-face-url>/api/face/config`.
  - Attaches the `X-API-Key` auth header.
  - Body payload: `{ maxFaces: number, minFaceSize: number, sureness: number }`

### 2.1 Background / Asynchronous Pipeline
1. **Adding Task**: When images are downloaded (e.g., Instagram scraper or profile image update), PRM creates an image task in the database:
   - Type: `analyze_img_face`
   - Status: `pending`
2. **Trigger API Call**: PRM makes an API call to PRM-face telling it to look at the tasks table.
   - Endpoint: `POST /api/face/process-trigger` (sends a lightweight trigger signal to PRM-face).
3. **Writing and Polling**: PRM-face runs in the background, downloads from S3, executes recognition, uploads face cutouts, writes direct data to PRM DB tables (`photos`, `image_questions`), and sets the task status to `completed`.
4. **Change Event Detection**: A database trigger or background job runner on PRM polls for completed tasks or monitors changes. Once a task is completed:
   - If there are unresolved unknown faces (entries in `image_questions`), PRM waits for user action.
   - If all faces are known/resolved, PRM immediately triggers the **Ollama description pipeline**.

### 2.2 Foreground / Synchronous Pipeline (Interactive Modal)
When a user uploads an image via the **Add** button in the top menu, we want immediate results.
- **`POST /api/img/add-interactive`**:
  - Receives uploaded multipart file.
  - Uploads the original image to S3 and registers it in the `photos` table.
  - Sends a synchronous HTTP request to PRM-face: `POST /api/face/detect-sync` passing the S3 URL.
  - PRM-face returns coordinates, face cutouts, and similarity matches in real-time.
  - PRM responds to the client modal with these results without creating background `image_questions` yet.

### 2.3 Unknown Faces Resolution API
- **`GET /api/image-questions/pending`**: List all pending face questions.
- **`POST /api/image-questions/resolve`**:
  - Body: `{ questionId: string, resolution: 'known' | 'create' | 'unknown', personId?: string, name?: string }`
  - Logic:
    - **`known`**: Associates the face with the existing `personId`. Calls PRM-face `/api/face/assign` to update similarity indexes.
    - **`create`**: API creates a new Person record in PRM, then associates the face with it, and calls PRM-face `/api/face/assign` to index it.
    - **`unknown`**: Sets the face ID status to unknown.
    - Updates `photos.facialIds` JSON array for the parent image.
    - Updates `image_questions` record status to `resolved`.
    - Check if all faces for the parent image are now identified. If yes, trigger the **Ollama description pipeline** for the photo.

### 2.4 Ollama / LLM Description Pipeline
- **`POST /api/img/describe-llm`**:
  - Body: `{ photoId: string }`
  - Gathers the original image and the resolved names of all faces:
    - `photos.facialIds` -> Extracts names of all identified people, social accounts, and their bounding box coordinates.
  - Sends payload to Ollama:
    - **Prompt context**: "Describe the scene in this image. You are provided with the locations of recognized faces. Bounding box [x, y, w, h] belongs to <Person Name/Social Account/Unknown Face>."
  - Saves the resulting text to `photos.imageDescription` and updates `photos.imageDescriptionAt`.
  - Returns result to UI (used for both background execution and holding the upload modal open).

---

## 3. Frontend UI Upgrades (React + TypeScript)

### 3.1 Upload Modal Upgrades ("Add" Button)
- Modifying the existing upload modal to block until face identifications are completed:
  1. User selects and uploads an image.
  2. A loader shows "Detecting faces...".
  3. Once detected, show the image with highlighted boxes over the detected faces.
  4. For each face, display a dropdown selector:
     - *Suggested Matches* (returned from similarity search).
     - *Link to Existing Person* (autocomplete search field).
     - *Create New Person* (text field).
     - *Mark as Unknown*.
  5. The user must assign a status to all detected faces before the modal can close.
  6. Add a toggle: **"Hold open to view LLM description results"**:
     - If enabled, once the user clicks "Save Assignments", it calls the description API synchronously, shows a loader, and displays the final scene description text inside the modal before final close.

### 3.2 New Page: "Unknown Faces"
- **Route**: `/unknown-faces`
- **UI Design**:
  - Sleek, grid-based dashboard of unresolved face cutouts.
  - Each item displays:
    - The cropped face thumbnail (`subImageUrl`).
    - The parent image thumbnail (with hover zoom effect).
    - Resolution control card.
  - **Resolution Actions**:
    - "This is an existing person": Dropdown with search filter.
    - "This is a new person": Text input for name + "Create and Link" button.
    - "Keep as unknown": Dismisses the item and marks it as unknown in the database.
  - Smooth animation triggers when an item is resolved and vanishes from the list.

### 3.3 Settings Page: Facial Recognition Parameters
Inside the existing Settings/Integrations page, add a section called **Facial Recognition Settings**:
- **UI Controls**:
  - **Max Faces**: A number input representing the maximum number of faces to attempt to detect in a single photo (e.g. range 1-100).
  - **Min Face Size**: A number input representing the minimum resolution of a face in pixels (e.g., 20px) to consider for detection.
  - **Face Sureness Requirement**: A slider (0% to 100%) or numeric input indicating the minimum confidence score threshold required for matching or detecting faces.
- **Workflow**:
  - **On Page Load**: Fire a query call to `GET /api/prm-face/config` to populate initial values.
  - **On Save Settings**: Fire a mutation call to `POST /api/prm-face/config` with values:
    ```json
    {
      "maxFaces": 15,
      "minFaceSize": 30,
      "sureness": 75
    }
    ```
    Show toast notification upon successful update.

---

## 4. Verification & Testing Plan

### 4.1 Automated Tests
- Test API payloads for `POST /api/img/add-interactive` to verify synchronous response times and schema conformance.
- Verify `imageQuestions` resolvers correctly trigger Drizzle insert/update actions.
- Test Settings endpoint mapping and verify the Express router handles proxying settings to PRM-face correctly.

### 4.2 Manual Verification
- Upload test group photos with multiple people (some known, some unknown) to verify modal highlights and select boxes.
- Monitor S3 bucket uploads under `faces/` to verify crops are correctly uploaded and accessible.
- Open the settings page, verify variables load successfully, slide the Face Sureness value to 95%, and verify that weaker face matches are filtered out during subsequent uploads.
