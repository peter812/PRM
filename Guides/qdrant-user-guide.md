# Qdrant Vector Storage User Guide & Snippets

This guide provides practical instructions and copy-pasteable snippets for setting up, configuring, and querying **Qdrant** with PRM (Personal Relationship Manager).

Qdrant powers PRM's semantic capabilities:
1. **Daily Notes Semantic Search**: Instant search through personal notes and journals by meaning.
2. **Universal Vectorization ("Super Search")**: Cross-domain semantic search indexing 9 distinct entity types (people, groups, notes, interactions, social accounts, daily notes, AI chats, images, and messages).
3. **App Knowledge Base (RAG)**: Ingests `prm-app-knowledge.csv` into Qdrant so the conversational AI assistant can answer how-to questions about using PRM.

---

## 1. Quick Start: Running Qdrant

### Option A: Standalone Docker Command

Run Qdrant in a Docker container with local disk persistence:

```bash
docker run -d \
  --name qdrant \
  -p 6333:6333 \
  -p 6334:6334 \
  -v qdrant_storage:/qdrant/storage:z \
  --restart unless-stopped \
  qdrant/qdrant:latest
```

- **REST Port (`6333`)**: Used by PRM for HTTP REST API requests.
- **gRPC Port (`6334`)**: Optional high-performance gRPC port.
- **Volume (`qdrant_storage`)**: Persists your vector collections across container restarts.

Test that Qdrant is responding:
```bash
curl http://localhost:6333/healthz
# Returns: 200 OK or {"title":"qdrant - vector search engine","version":"..."}
```

---

### Option B: Docker Compose Integration

Add the Qdrant service to your `docker-compose.yml` or `docker-compose.dev.yml`:

```yaml
version: "3.9"

services:
  # ... postgres, people-manager, whisper ...

  qdrant:
    image: qdrant/qdrant:latest
    container_name: qdrant
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_data:/qdrant/storage
    restart: unless-stopped
    networks:
      people_net:
        ipv4_address: 10.5.0.14

volumes:
  postgres_data:
  qdrant_data:

networks:
  people_net:
    driver: bridge
    ipam:
      driver: default
      config:
        - subnet: 10.5.0.0/24
```

> [!TIP]
> When running PRM inside Docker, configure the Qdrant URL in PRM settings as `http://qdrant:6333` (service name) rather than `localhost:6333`.

---

## 2. Embedding Model Setup (Ollama)

PRM uses your local **Ollama** instance to convert text into vector embeddings before storing them in Qdrant.

### Pulling Recommended Embedding Models

Run these commands on your host where Ollama is running:

```bash
# Recommended default (768-dimensional embeddings, high accuracy & speed)
ollama pull nomic-embed-text

# Alternative high-accuracy model (1024-dimensional embeddings)
ollama pull mxbai-embed-large

# Lightweight model (384-dimensional embeddings)
ollama pull all-minilm
```

Verify the model is installed:
```bash
ollama list
```

---

## 3. Configuring PRM Web UI

Navigate to **Settings → Vector Storage** (`/settings/vector`):

```
┌──────────────────────────────────────────────────────────┐
│  Vector Storage Settings (/settings/vector)             │
├──────────────────────────────────────────────────────────┤
│  1. Enable Vector Storage: [ ON ]                        │
│  2. Qdrant Connection:                                   │
│     - Server URL:  http://localhost:6333                 │
│     - API Key:     [Optional] (leave blank for local)    │
│     - Collection:  prm_daily_notes                       │
│     [ Save ]  [ Test connection ]                        │
│                                                          │
│  3. Embedding Model:                                     │
│     - Select: nomic-embed-text:latest                    │
│     [ Save model ]                                       │
│                                                          │
│  4. Universal Vectorization: [ ON ]                      │
│     [ Vectorize Everything Now ]                         │
│                                                          │
│  5. App Knowledge Base: [ ON ]                           │
│     [ Re-index App Knowledge Base ]                      │
└──────────────────────────────────────────────────────────┘
```

1. **Enable Vector Storage**: Toggle switch to **ON**.
2. **Server URL**: Enter `http://localhost:6333` (or your remote/Docker URL).
3. **Test connection**: Click **Test connection** — a green checkmark confirms PRM connected to Qdrant.
4. **Select Embedding Model**: Choose `nomic-embed-text` from the dropdown and click **Save model**.
5. **Vectorize Everything**: Under Universal Vectorization, toggle to **ON** and click **Vectorize Everything Now** to index your contacts, notes, interactions, and images.
6. **App Knowledge Base**: Toggle to **ON** and click **Re-index App Knowledge Base** to index application documentation for AI chat.

---

## 4. Developer & API Snippets

All vector operations can be inspected or automated through PRM's REST API.

### Snippet 1: Check Qdrant Connection Status

#### cURL
```bash
curl -X POST http://localhost:5000/api/vector/test \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key"
```

#### TypeScript / Fetch
```typescript
const res = await fetch("/api/vector/test", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
});
const data = await res.json();
console.log(data); // { ok: true, message: "Connected to Qdrant successfully." }
```

---

### Snippet 2: Run Semantic Super Search

Perform semantic search across all 9 entity types:

#### cURL
```bash
# Query all entity types with score threshold of 0.70
curl "http://localhost:5000/api/vector/universal/search?q=machine%20learning%20researcher&limit=10" \
  -H "X-API-Key: your-api-key"

# Filter specifically to people
curl "http://localhost:5000/api/vector/universal/search?q=investor&type=person&limit=5" \
  -H "X-API-Key: your-api-key"
```

#### TypeScript / Fetch
```typescript
async function superSearch(query: string, typeFilter?: string) {
  const params = new URLSearchParams({ q: query, limit: "15" });
  if (typeFilter) params.append("type", typeFilter);

  const response = await fetch(`/api/vector/universal/search?${params.toString()}`);
  const data = await response.json();
  
  // Results format:
  // [
  //   {
  //     "entityId": "uuid-123",
  //     "type": "person",
  //     "title": "Dr. Aris Thorne",
  //     "snippet": "Senior AI Researcher specializing in graph transformers...",
  //     "score": 0.842
  //   }
  // ]
  return data.results;
}
```

#### Python
```python
import requests

def super_search(query: str, api_key: str, entity_type: str = None):
    url = "http://localhost:5000/api/vector/universal/search"
    headers = {"X-API-Key": api_key}
    params = {"q": query, "limit": 10}
    if entity_type:
        params["type"] = entity_type

    res = requests.get(url, headers=headers, params=params)
    res.raise_for_status()
    return res.json()["results"]

results = super_search("founder in robotics", "your-api-key")
for item in results:
    print(f"[{item['type'].upper()}] {item['title']} (score: {item['score']:.2f})")
    print(f"  {item['snippet']}\n")
```

---

### Snippet 3: Trigger Universal Re-Vectorization

Re-embed all entities in background or sync newly imported records:

#### cURL
```bash
curl -X POST http://localhost:5000/api/vector/universal/vectorize-all \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key"
```

#### Response
```json
{
  "ok": true,
  "processed": 184,
  "failed": 0,
  "total": 184,
  "errors": []
}
```

---

### Snippet 4: Query the App Knowledge Base

Semantic search into PRM documentation:

#### cURL
```bash
curl "http://localhost:5000/api/vector/app-knowledge/search?q=how%20do%20I%20import%20instagram%20stories&limit=3" \
  -H "X-API-Key: your-api-key"
```

#### TypeScript / Fetch
```typescript
const res = await fetch("/api/vector/app-knowledge/search?q=how%20to%20merge%20contacts");
const data = await res.json();
console.log(data.results);
```

---

## 5. Collections & Schema Architecture

PRM maintains three distinct Qdrant collections:

| Collection Name | Content | Vector Size | Distance Metric |
|-----------------|---------|-------------|-----------------|
| `prm_daily_notes` | User daily notes & timestamps | 768 / 1024 / 384 (model-dependent) | Cosine |
| `prm_universal` | People, Groups, Notes, Interactions, Social Accounts, Images, Chats, Messages | 768 / 1024 / 384 | Cosine |
| `prm-app-knowledge` | Application how-to knowledge base chunks | 768 / 1024 / 384 | Cosine |

### Universal Payload Schema

Each point in `prm_universal` contains structured payload metadata for filtering and display:

```json
{
  "id": "e9b25a3d-4235-430c-8be9-0f0be104ce83",
  "vector": [0.0142, -0.0481, 0.0812, "..."],
  "payload": {
    "type": "person",
    "entity_id": "c1f7b0e4-98ad-4a12-8e12-32a104cde567",
    "user_id": "admin-uuid",
    "title": "Jane Doe",
    "snippet": "Product Manager at TechNova. Tags: tech, mentor. Phone: 555-0192",
    "created_at": "2026-06-20T10:00:00.000Z",
    "meta": {
      "company": "TechNova",
      "title": "Product Manager"
    }
  }
}
```

---

## 6. Troubleshooting & Best Practices

### 1. "Qdrant URL is not configured" or Network Connection Refused
- **Cause**: PRM cannot reach the Qdrant port.
- **Fix**: Check `curl http://localhost:6333/healthz`. If running in Docker, use container network name `http://qdrant:6333`.

### 2. Changing Embedding Models
- **Important**: Changing the embedding model (e.g. from `nomic-embed-text` [768 dims] to `mxbai-embed-large` [1024 dims]) creates a vector dimension mismatch.
- **Fix**: After changing the model in **Settings → Vector Storage**, PRM automatically drops the old mismatched collection. Run **Vectorize Everything Now** to regenerate all vectors with the new dimension size.

### 3. Cosine Similarity Thresholds
- High-dimensional models (768–1024 dimensions) exhibit a baseline similarity of ~0.50–0.58 between unrelated English sentences.
- For high-precision search, PRM filters candidates with `threshold >= 0.70`.
