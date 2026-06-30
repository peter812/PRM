# PRM-Face Image Pipeline Upgrade Plan (PRM-face Application)

This plan details the upgrade path for the **PRM-face** Python application. Currently, PRM-face is a python-based face recognition service with no connection to external databases or S3 servers. 

This upgrade implements a **delayed initialization** pattern: connection configurations are passed dynamically from the PRM application to PRM-face when the initial API key generation (handshake) occurs. Once configured, PRM-face persists these settings, instantiates its DB engine and S3 clients, processes background image tasks, crops and uploads face cutouts, writes results directly to the PRM database, and exposes settings management API endpoints.

---

## 1. Handshake-Driven Connection Initialization

PRM-face will start up in an **uninitialized state**, with its PostgreSQL and S3 connection configurations set to `None`. 

### 1.1 Exchanging Setup Code & Passing Connection Variables
Instead of initializing connections at startup, PRM-face will wait for the handshake endpoint `POST /api/get-api-key`. 

- **Endpoint**: `POST /api/get-api-key`
- **Authentication**: Setup code printed to console (`setup_code`)
- **Request Parameters** (`multipart/form-data` or JSON):
  - `setup_code` (Required)
  - `label` (Optional)
  - `database_url` (Required)
  - `s3_endpoint` (Required)
  - `s3_bucket` (Required)
  - `s3_access_key` (Required)
  - `s3_secret_key` (Required)

### 1.2 Persisting & Initializing Configurations
When the handshake endpoint is successfully executed:
1. **Validation**: Check that the database URL is format-valid and S3 credentials can successfully connect to the object storage.
2. **Persistence**: Write the configuration parameters to a local file (e.g. `.env.runtime` or a `config.json` file in a state folder) so they persist if the PRM-face process is restarted.
3. **Engine Initialization**:
   - Instantiate the SQLAlchemy/SQLModel database connection pool.
   - Instantiate the S3 `boto3` client.
4. **API Key Generation**: Returns the generated admin API key back to PRM.

```python
# app/config.py
class RuntimeConfig:
    def __init__(self):
        self.database_url = None
        self.s3_endpoint = None
        self.s3_bucket = None
        self.s3_access_key = None
        self.s3_secret_key = None
        
        # Recognition Settings
        self.max_faces = 10
        self.min_face_size = 20  # Pixels
        self.sureness = 0.65     # 65% (Cosine similarity threshold)
        
        self.initialized = False

    def load_from_file(self):
        if os.path.exists(".env.runtime"):
            # Load stored config and trigger initialization
            ...
            self.initialized = True

runtime_config = RuntimeConfig()
```

### 1.3 Request Guard Middleware
A middleware or API dependency will check `runtime_config.initialized` before routing to any other endpoints (e.g., `/faces/query`, `/faces/pickout`, etc.):
- If **not initialized**: Immediately return HTTP `503 Service Unavailable` with the response body:
  ```json
  {
    "setup_completed": false,
    "error": "Database and S3 connections are not initialized. Please complete the setup handshake at /api/get-api-key."
  }
  ```

---

## 1.4 Recognition Parameters Management APIs

Once setup is complete, PRM-face supports dynamic adjustments to facial recognition model parameters.

### `GET /api/face/config`
Retrieve current values of active recognition parameters.
- **Headers**: `X-API-Key` (Required)
- **Response `200`**:
  ```json
  {
    "max_faces": 10,
    "min_face_size": 20,
    "sureness": 65
  }
  ```

### `POST /api/face/config`
Updates recognition parameters and saves changes permanently to persistent storage.
- **Headers**: `X-API-Key` (Required)
- **Body (`application/json`)**:
  ```json
  {
    "max_faces": 15,
    "min_face_size": 30,
    "sureness": 75
  }
  ```
- **Action**:
  - Validates constraints (e.g., `sureness` must be between `0` and `100`, `max_faces` >= `1`).
  - Writes new configuration values to the local `.env.runtime` or config file.
  - Updates running in-memory parameters `runtime_config.max_faces`, `runtime_config.min_face_size`, and maps `sureness / 100` to the recognition model threshold (`runtime_config.sureness`).
- **Response `200`**:
  ```json
  {
    "success": true,
    "updated_config": {
      "max_faces": 15,
      "min_face_size": 30,
      "sureness": 75
    }
  }
  ```

---

## 2. Database and S3 Clients

Once connections are successfully initialized:

### 2.1 Database Client
```python
# app/db.py
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

_engine = None
_session_maker = None

def initialize_db(database_url: str):
    global _engine, _session_maker
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    
    _engine = create_async_engine(database_url, pool_size=10, max_overflow=20)
    _session_maker = sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)

async def get_session() -> AsyncSession:
    if not _session_maker:
        raise HTTPException(status_code=503, detail="Database not initialized")
    async with _session_maker() as session:
        yield session
```

### 2.2 S3 Client
```python
# app/s3.py
import aioboto3

_s3_session = None

def initialize_s3():
    global _s3_session
    _s3_session = aioboto3.Session()

def get_s3_client():
    if not _s3_session:
        raise HTTPException(status_code=503, detail="S3 client not initialized")
    return _s3_session.client(
        's3',
        endpoint_url=runtime_config.s3_endpoint,
        aws_access_key_id=runtime_config.s3_access_key,
        aws_secret_key_id=runtime_config.s3_secret_key
    )
```

---

## 3. Background Task Processing Loop

Once connections are active, a background worker process parses image processing requests:
1. **Wakeup Trigger**: Expose a route `POST /api/face/process-trigger`. When called, signals the task queue worker to pull the next task.
2. **Fetch Task**:
   - Query the PRM database `image_tasks` table for the oldest record where `status = 'pending'` and `type = 'analyze_img_face'`.
   - Update task status to `'in_progress'`.
3. **Download Image**:
   - Download the original image from the S3 bucket using the initialized S3 client.

---

## 4. Facial Detection, Recognition, and Cutouts

1. **Face Detection**: Run MTCNN/RetinaFace/InsightFace models to detect face bounding boxes.
   - Apply updated parameters:
     - Ignore faces smaller than `runtime_config.min_face_size` pixels.
     - Detect up to a maximum of `runtime_config.max_faces` faces.
2. **Cropping & Upload**:
   - Crop each detected face.
   - Upload the crop as a separate image asset to the S3 bucket under the prefix `./faces/` (e.g. `faces/<face_uuid>.jpg`).
3. **Similarity Search**:
   - Extract embedding vectors.
   - Compare them against known faces in the DB.
   - Resolve to a `person_uuid` if the confidence matches or exceeds the sureness requirement (`runtime_config.sureness` e.g., `0.75`); otherwise, treat as unknown/anonymous.

---

## 5. Direct Database Writing

After processing is complete, PRM-face writes results directly to the PRM database:
1. **Update `photos` Table**:
   - Set `face_id_at = NOW()`.
   - Populate `facial_ids` column with details of all detected faces (bounds, S3 cutout URL, face UUID, and resolved person/social account ID).
2. **Populate `image_questions` Table**:
   - For any unrecognized/unknown faces, insert a row in `image_questions` detailing the face UUID, crop S3 URL, and bounds.
3. **Complete `image_tasks`**:
   - Mark task status as `'completed'` and update logs/results.

---

## 6. Synchronous Interactive Endpoint

For real-time UI uploads:
- Expose `POST /api/face/detect-sync`
- Processes the upload immediately, crops and uploads face cutouts to S3, searches embeddings using current `runtime_config` settings, and returns matches directly to the Express server without creating database `image_questions` records.

---

## 7. Verification Plan

### 7.1 Automated Tests
- Test that calling protected endpoints prior to generating the API key correctly returns a `503 Service Unavailable` response.
- Verify that providing invalid database or S3 credentials during the handshake fails validation and does not overwrite existing configuration files.
- Test `GET` and `POST` to `/api/face/config` endpoints to ensure payload values update variables and persist to files.

### 7.2 Manual Verification
- Launch PRM-face, verify it lists setup status as `setup_completed: false`.
- Call setup handshake `POST /api/get-api-key` with valid credentials, verify connection engines initialize, and confirm subsequent endpoints unlock.
- Adjust parameters via settings, save, and check that the config file contains updated values and models use the updated values.
