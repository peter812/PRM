import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { 
  Copy, 
  CheckCheck, 
  ChevronDown, 
  ChevronRight, 
  Search, 
  BookOpen, 
  Key, 
  Users, 
  FileText, 
  Activity, 
  Heart, 
  GitFork, 
  UserCheck, 
  Play, 
  FolderSync, 
  ImageIcon, 
  Network, 
  Terminal,
  Database,
  ArrowUpDown,
  BookMarked
} from "lucide-react";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";

interface Endpoint {
  id: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  queryParams?: Array<{ name: string; type: string; description: string; required?: boolean }>;
  body?: string;
  response: string;
  example?: string;
}

interface Category {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  endpoints: Endpoint[];
}

export default function ApiDocs() {
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null);
  const [expandedEndpoints, setExpandedEndpoints] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("all");
  const [isAuthExpanded, setIsAuthExpanded] = useState(false);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedEndpoint(id);
    setTimeout(() => setCopiedEndpoint(null), 2000);
  };

  const toggleEndpoint = (id: string) => {
    const newExpanded = new Set(expandedEndpoints);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedEndpoints(newExpanded);
  };

  const baseUrl = window.location.origin;

  // Endpoint Definitions grouped by Category
  const categories: Category[] = useMemo(() => [
    {
      id: "people",
      name: "People & Core CRM",
      icon: Users,
      description: "Core CRM resources for managing contacts, personal notes, interactions, relationships, and groups.",
      endpoints: [
        {
          id: "get-people",
          method: "GET",
          path: "/api/people",
          summary: "Get all people",
          description: "Get all people with optional search query.",
          queryParams: [
            { name: "search", type: "string", description: "Search by name, company, email, or tags", required: false },
            { name: "includeRelationships", type: "boolean", description: "Include relationships in the response", required: false },
          ],
          response: `[
  {
    "id": "uuid-1",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "company": "Acme Corp",
    "title": "CEO",
    "tags": ["partner", "vip"],
    "createdAt": "2026-01-15T10:00:00Z"
  }
]`,
          example: `fetch('${baseUrl}/api/people?includeRelationships=true')
  .then(res => res.json())
  .then(data => console.log(data));`,
        },
        {
          id: "get-people-paginated",
          method: "GET",
          path: "/api/people/paginated",
          summary: "List people (paginated)",
          description: "Retrieve contacts sorted by highest relationship value or ELO score.",
          queryParams: [
            { name: "offset", type: "number", description: "Starting index position (default: 0)", required: false },
            { name: "limit", type: "number", description: "Number of records to return (default: 30, max: 100)", required: false },
            { name: "sortByElo", type: "boolean", description: "Sort by ELO score instead of relationship value", required: false },
          ],
          response: `[
  {
    "id": "uuid-1",
    "firstName": "John",
    "lastName": "Doe",
    "maxRelationshipValue": 80,
    "relationshipTypeName": "Best Friend",
    "relationshipTypeColor": "#ec4899",
    "eloScore": 1200
  }
]`,
          example: `fetch('${baseUrl}/api/people/paginated?limit=10&sortByElo=true')
  .then(res => res.json())
  .then(data => console.log(data));`,
        },
        {
          id: "get-person-flow",
          method: "GET",
          path: "/api/people/:id/flow",
          summary: "Get activity timeline flow",
          description: "Returns a unified, chronologically sorted timeline of notes and interactions for a person.",
          queryParams: [
            { name: "limit", type: "number", description: "Number of items to return (default: 20)", required: false },
            { name: "cursor", type: "string", description: "Pagination cursor token from a previous response", required: false },
          ],
          response: `{
  "items": [
    {
      "type": "note",
      "id": "note-uuid",
      "content": "Discussed partnership opportunities.",
      "createdAt": "2026-06-25T14:30:00Z"
    },
    {
      "type": "interaction",
      "id": "interaction-uuid",
      "description": "Lunch meeting",
      "date": "2026-06-24T12:00:00Z"
    }
  ],
  "nextCursor": "cursor-token-xyz"
}`,
          example: `fetch('${baseUrl}/api/people/uuid-1/flow?limit=5')
  .then(res => res.json())
  .then(data => console.log(data));`,
        },
        {
          id: "create-person",
          method: "POST",
          path: "/api/people",
          summary: "Create a person",
          description: "Create a new contact. The combination of first and last name must be unique.",
          body: `{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "company": "Acme Corp",
  "title": "CEO",
  "tags": ["partner"]
}`,
          response: `{
  "id": "uuid-1",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "company": "Acme Corp",
  ...
}`,
          example: `fetch('${baseUrl}/api/people', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ firstName: 'John', lastName: 'Doe' })
}).then(res => res.json());`,
        },
        {
          id: "get-notes",
          method: "GET",
          path: "/api/notes",
          summary: "Get notes",
          description: "Get all notes, or filter to notes for a specific person.",
          queryParams: [
            { name: "personId", type: "string", description: "Filter notes to a specific person ID", required: false }
          ],
          response: `[
  {
    "id": "uuid-note",
    "personId": "uuid-1",
    "personName": "John Doe",
    "content": "Follow up in July",
    "createdAt": "2026-06-20T09:00:00Z"
  }
]`,
          example: `fetch('${baseUrl}/api/notes?personId=uuid-1')
  .then(res => res.json());`,
        },
        {
          id: "create-note",
          method: "POST",
          path: "/api/notes",
          summary: "Create a note",
          description: "Create a note linked to a person.",
          body: `{
  "personId": "uuid-1",
  "content": "Discussed product roadmap."
}`,
          response: `{
  "id": "uuid-note",
  "personId": "uuid-1",
  "content": "Discussed product roadmap.",
  "createdAt": "2026-06-29T02:00:00Z"
}`,
          example: `fetch('${baseUrl}/api/notes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ personId: 'uuid-1', content: 'Note text' })
}).then(res => res.json());`,
        },
        {
          id: "get-interactions",
          method: "GET",
          path: "/api/interactions",
          summary: "Get interactions",
          description: "Query interactions between people and groups with filters.",
          queryParams: [
            { name: "personId", type: "string", description: "Filter by person UUID", required: false },
            { name: "groupId", type: "string", description: "Filter by group UUID", required: false },
            { name: "startDate", type: "string", description: "ISO date start boundary", required: false },
            { name: "endDate", type: "string", description: "ISO date end boundary", required: false },
            { name: "count_limit", type: "number", description: "Limit response items size", required: false }
          ],
          response: `[
  {
    "id": "uuid-int",
    "peopleIds": ["uuid-1", "uuid-2"],
    "groupIds": [],
    "title": "Strategy Sync",
    "description": "Reviewed visual graphics and ELO scoring",
    "date": "2026-06-28T10:00:00Z",
    "type": {
      "id": "uuid-type",
      "name": "Meeting",
      "color": "#3b82f6",
      "value": 70
    }
  }
]`,
          example: `fetch('${baseUrl}/api/interactions?count_limit=10')
  .then(res => res.json());`,
        },
        {
          id: "get-relationships",
          method: "GET",
          path: "/api/relationships/:personId",
          summary: "Get relationships",
          description: "Get all directional and reciprocal relationships for a person.",
          queryParams: [
            { name: "count_limit", type: "number", description: "Limit number of results", required: false },
            { name: "value_limit", type: "number", description: "Filter by minimum relationship value (0-100)", required: false }
          ],
          response: `[
  {
    "id": "uuid-rel",
    "fromPersonId": "uuid-1",
    "toPersonId": "uuid-2",
    "toPerson": { "firstName": "Alice", "lastName": "Smith" },
    "type": { "name": "Partner", "value": 90, "color": "#ef4444" },
    "notes": "Spouse"
  }
]`,
          example: `fetch('${baseUrl}/api/relationships/uuid-1?value_limit=50')
  .then(res => res.json());`
        }
      ]
    },
    {
      id: "elo",
      name: "ELO Ranking System",
      icon: ArrowUpDown,
      description: "Endpoints supporting pairwise comparisons to build a relative ELO-based ranking system of contacts.",
      endpoints: [
        {
          id: "get-elo-pair",
          method: "GET",
          path: "/api/people/elo/pair",
          summary: "Get random pair for voting",
          description: "Returns two random people candidates to compare.",
          response: `[
  { "id": "uuid-1", "firstName": "John", "lastName": "Doe", "eloScore": 1200 },
  { "id": "uuid-2", "firstName": "Jane", "lastName": "Smith", "eloScore": 1180 }
]`,
          example: `fetch('${baseUrl}/api/people/elo/pair')
  .then(res => res.json());`
        },
        {
          id: "submit-elo-vote",
          method: "POST",
          path: "/api/people/elo/vote",
          summary: "Submit ELO vote match",
          description: "Submit the result of a comparison match to update both ELO scores.",
          body: `{
  "winnerId": "uuid-1",
  "loserId": "uuid-2"
}`,
          response: `{
  "success": true,
  "winnerNewElo": 1216,
  "loserNewElo": 1164
}`,
          example: `fetch('${baseUrl}/api/people/elo/vote', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ winnerId: 'uuid-1', loserId: 'uuid-2' })
}).then(res => res.json());`
        }
      ]
    },
    {
      id: "family",
      name: "Family & Lineage",
      icon: GitFork,
      description: "Manage genealogic trees, parents, children, spouses, and partnerships.",
      endpoints: [
        {
          id: "get-family-types",
          method: "GET",
          path: "/api/family-relationships/types",
          summary: "Get family relationship types",
          description: "Get all custom relationship type IDs and meta for families.",
          response: `[
  { "id": "uuid-type", "name": "Mother", "type": "mother", "color": "#ec4899" }
]`,
          example: `fetch('${baseUrl}/api/family-relationships/types')
  .then(res => res.json());`
        },
        {
          id: "get-family-tree",
          method: "GET",
          path: "/api/people/:personId/family",
          summary: "Get family tree graph data",
          description: "Get a person's family tree graph (parents, children, and spouses).",
          response: `{
  "person": { "id": "uuid-1", "firstName": "John", "lastName": "Doe" },
  "parents": [
    { "id": "uuid-mom", "firstName": "Mary", "lastName": "Doe", "relationshipId": "rel-id-1" }
  ],
  "children": [],
  "spouses": []
}`,
          example: `fetch('${baseUrl}/api/people/uuid-1/family')
  .then(res => res.json());`
        },
        {
          id: "create-lineage",
          method: "POST",
          path: "/api/family/lineage",
          summary: "Create lineage link",
          description: "Link a parent to a child in the database.",
          body: `{
  "parentId": "uuid-mom",
  "childId": "uuid-1"
}`,
          response: `{
  "id": "lineage-link-uuid",
  "parentId": "uuid-mom",
  "childId": "uuid-1"
}`,
          example: `fetch('${baseUrl}/api/family/lineage', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ parentId: 'uuid-mom', childId: 'uuid-1' })
}).then(res => res.json());`
        },
        {
          id: "create-partnership",
          method: "POST",
          path: "/api/family/partnerships",
          summary: "Create partnership link",
          description: "Link spouses, partners, or exes.",
          body: `{
  "person1Id": "uuid-1",
  "person2Id": "uuid-spouse",
  "type": "spouse",
  "isCurrent": true
}`,
          response: `{
  "id": "partnership-uuid",
  "person1Id": "uuid-1",
  "person2Id": "uuid-spouse",
  "type": "spouse",
  "isCurrent": true
}`,
          example: `fetch('${baseUrl}/api/family/partnerships', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ person1Id: 'uuid-1', person2Id: 'uuid-spouse', type: 'spouse', isCurrent: true })
}).then(res => res.json());`
        }
      ]
    },
    {
      id: "social-accounts",
      name: "Social Accounts & Posts",
      icon: Network,
      description: "Endpoints to link external profiles (Instagram, LinkedIn, Twitter) to contacts, track network follower logs, and query posts.",
      endpoints: [
        {
          id: "get-social-accounts",
          method: "GET",
          path: "/api/social-accounts",
          summary: "Get all social accounts",
          description: "Retrieve all social profiles with optional search and type filtering.",
          queryParams: [
            { name: "search", type: "string", description: "Filter by username or nickname", required: false },
            { name: "typeId", type: "string", description: "Filter by social account type UUID", required: false }
          ],
          response: `[
  {
    "id": "social-uuid",
    "username": "johndoe",
    "ownerUuid": "person-uuid-1",
    "typeId": "type-uuid-instagram",
    "currentProfile": {
      "nickname": "John D",
      "accountUrl": "https://instagram.com/johndoe",
      "imageUrl": "https://...",
      "bio": "Developer and blogger"
    }
  }
]`,
          example: `fetch('${baseUrl}/api/social-accounts?search=johndoe')
  .then(res => res.json());`
        },
        {
          id: "get-social-accounts-paginated",
          method: "GET",
          path: "/api/social-accounts/paginated",
          summary: "Get paginated social accounts",
          description: "Retrieve paginated list of social profiles.",
          queryParams: [
            { name: "offset", type: "number", description: "Starting offset index", required: false },
            { name: "limit", type: "number", description: "Number of records to return", required: false },
            { name: "search", type: "string", description: "Filter by username/nickname", required: false },
            { name: "followsYou", type: "boolean", description: "Filter to accounts that follow you", required: false }
          ],
          response: `[ ... ]`,
          example: `fetch('${baseUrl}/api/social-accounts/paginated?limit=10&followsYou=true')
  .then(res => res.json());`
        },
        {
          id: "get-social-followers",
          method: "GET",
          path: "/api/social-accounts/:id/followers",
          summary: "Get account followers",
          description: "Get list of followers based on recorded social graph network state.",
          response: `[
  { "id": "follower-social-uuid", "username": "alice_s", "nickname": "Alice" }
]`,
          example: `fetch('${baseUrl}/api/social-accounts/social-uuid/followers')
  .then(res => res.json());`
        },
        {
          id: "get-social-posts",
          method: "GET",
          path: "/api/social-accounts/:id/posts",
          summary: "Get account posts",
          description: "Retrieve posts scraped or imported for a social account.",
          response: `[
  {
    "id": "post-uuid",
    "content": "Had a great time presenting at the tech conference!",
    "postUrl": "https://instagram.com/p/abc123xyz",
    "timestamp": "2026-06-25T15:00:00Z",
    "mediaUrl": "https://..."
  }
]`,
          example: `fetch('${baseUrl}/api/social-accounts/social-uuid/posts')
  .then(res => res.json());`
        },
        {
          id: "create-social-post",
          method: "POST",
          path: "/api/social-accounts/:id/posts",
          summary: "Create a social post",
          description: "Save a new post structure for a social account.",
          body: `{
  "content": "New post caption text",
  "postUrl": "https://instagram.com/p/newpost123",
  "mediaUrl": "https://...",
  "timestamp": "2026-06-29T02:00:00Z"
}`,
          response: `{
  "id": "post-uuid",
  "socialAccountId": "social-uuid",
  "content": "New post caption text",
  ...
}`,
          example: `fetch('${baseUrl}/api/social-accounts/social-uuid/posts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: 'Post content' })
}).then(res => res.json());`
        }
      ]
    },
    {
      id: "matching",
      name: "Account Matching",
      icon: UserCheck,
      description: "Automated utilities to resolve unmatched CRM contacts and connect them to candidate profiles using name similarity algorithm scoring.",
      endpoints: [
        {
          id: "get-matching-next",
          method: "GET",
          path: "/api/account-matching/next",
          summary: "Get next unmatched contact",
          description: "Returns the next contact with no connected social profiles, alongside candidate matching social profiles.",
          queryParams: [
            { name: "skip", type: "string", description: "Comma-separated list of person UUIDs to temporarily bypass", required: false }
          ],
          response: `{
  "person": { "id": "uuid-1", "firstName": "Alice", "lastName": "Smith" },
  "candidates": [
    { "id": "candidate-uuid", "username": "alicesmith", "matchScore": 140, "typeName": "instagram" }
  ]
}`,
          example: `fetch('${baseUrl}/api/account-matching/next')
  .then(res => res.json());`
        },
        {
          id: "connect-matching",
          method: "POST",
          path: "/api/account-matching/connect",
          summary: "Connect contact to accounts",
          description: "Saves links between a person and social profile IDs. Syncs profile images automatically.",
          body: `{
  "personId": "uuid-1",
  "socialAccountIds": ["candidate-uuid"]
}`,
          response: `{ "success": true }`,
          example: `fetch('${baseUrl}/api/account-matching/connect', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ personId: 'uuid-1', socialAccountIds: ['candidate-uuid'] })
}).then(res => res.json());`
        },
        {
          id: "ignore-matching",
          method: "POST",
          path: "/api/account-matching/ignore",
          summary: "Mark as having no social media",
          description: "Flags contact as having no social media to permanently filter them out of matching queues.",
          body: `{
  "personId": "uuid-1"
}`,
          response: `{ "success": true }`,
          example: `fetch('${baseUrl}/api/account-matching/ignore', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ personId: 'uuid-1' })
}).then(res => res.json());`
        }
      ]
    },
    {
      id: "tasks",
      name: "Tasks & Workers",
      icon: Play,
      description: "Manage background asynchronous tasks (image scraping, follower count syncing, bulk data processing).",
      endpoints: [
        {
          id: "get-tasks",
          method: "GET",
          path: "/api/tasks",
          summary: "List background tasks",
          description: "Get tasks lists matching state query filters.",
          response: `[
  {
    "id": "task-uuid-1",
    "type": "scrape-profile-pics",
    "status": "completed",
    "progress": 100,
    "createdAt": "2026-06-28T09:00:00Z"
  }
]`,
          example: `fetch('${baseUrl}/api/tasks')
  .then(res => res.json());`
        },
        {
          id: "get-worker-status",
          method: "GET",
          path: "/api/tasks/worker-status",
          summary: "Get task runner status",
          description: "Retrieve worker daemon load and processing state.",
          response: `{
  "status": "idle",
  "activeTasksCount": 0,
  "lastPoll": "2026-06-29T02:30:00Z"
}`,
          example: `fetch('${baseUrl}/api/tasks/worker-status')
  .then(res => res.json());`
        },
        {
          id: "cancel-task",
          method: "DELETE",
          path: "/api/tasks/:id",
          summary: "Cancel background task",
          description: "Revoke or stop an active or scheduled task process.",
          response: `{ "success": true }`,
          example: `fetch('${baseUrl}/api/tasks/task-uuid-1', { method: 'DELETE' })
  .then(res => res.json());`
        },
        {
          id: "mass-refresh-followers",
          method: "POST",
          path: "/api/tasks/mass-refresh-follower-count",
          summary: "Trigger mass follower sync",
          description: "Enqueues background task worker to sync followers metrics for all accounts.",
          response: `{
  "success": true,
  "taskId": "task-uuid-2"
}`,
          example: `fetch('${baseUrl}/api/tasks/mass-refresh-follower-count', { method: 'POST' })
  .then(res => res.json());`
        }
      ]
    },
    {
      id: "data",
      name: "Data Management",
      icon: FolderSync,
      description: "Import and export full application databases or platform spreadsheets in XML, CSV, and VCF formats.",
      endpoints: [
        {
          id: "export-xml",
          method: "GET",
          path: "/api/export-xml",
          summary: "Export full backup XML",
          description: "Generates download containing users, people, links, notes, interaction histories, and types.",
          queryParams: [
            { name: "includeHistory", type: "boolean", description: "Include deep follower logs & version state logs", required: false }
          ],
          response: `<!-- Returns file attachment Content-Type: application/xml -->
<prm_backup version="2.0">
  <people>
    <person id="uuid-1" firstName="John" lastName="Doe" />
  </people>
</prm_backup>`,
          example: `// Redirect browser to trigger file download
window.location.href = '${baseUrl}/api/export-xml?includeHistory=true';`
        },
        {
          id: "import-xml",
          method: "POST",
          path: "/api/import-xml",
          summary: "Import XML database",
          description: "Overwrites or merges backup xml structure. Dedupes people by name.",
          body: `// Multipart Form Data File upload
// field name: 'xml'`,
          response: `{
  "success": true,
  "imported": { "people": 25, "notes": 50, "relationships": 12 },
  "skipped": { "people": 3 }
}`,
          example: `// Construct FormData and post file
const formData = new FormData();
formData.append('xml', fileInput.files[0]);
fetch('${baseUrl}/api/import-xml', {
  method: 'POST',
  body: formData
}).then(res => res.json());`
        },
        {
          id: "import-instagram",
          method: "POST",
          path: "/api/import-instagram",
          summary: "Import Instagram export CSV",
          description: "Uploads followers/following exported tables. Maps network links and schedules avatar imports.",
          body: `// Multipart Form Data Fields:
// - csv: file
// - accountId: string (socialAccountUuid)
// - importType: 'followers' | 'following'
// - forceUpdateImages: boolean (optional)`,
          response: `{
  "success": true,
  "imported": 142,
  "updated": 15,
  "total": 157
}`,
          example: `const formData = new FormData();
formData.append('csv', fileInput.files[0]);
formData.append('accountId', 'social-uuid-1');
formData.append('importType', 'followers');
fetch('${baseUrl}/api/import-instagram', {
  method: 'POST',
  body: formData
}).then(res => res.json());`
        }
      ]
    },
    {
      id: "search-graph",
      name: "Search & Graphs",
      icon: Network,
      description: "Query graph rendering maps (SVG, 3D Canvas force-directed charts) and global mega-search engines.",
      endpoints: [
        {
          id: "mega-search",
          method: "GET",
          path: "/api/mega-search",
          summary: "Advanced mega search",
          description: "Search dynamically across people, groups, interactions, notes, and profiles at once.",
          queryParams: [
            { name: "q", type: "string", description: "Search query query string", required: true },
            { name: "includePeople", type: "boolean", description: "Include contacts results (default: true)", required: false },
            { name: "includeNotes", type: "boolean", description: "Include notes results (default: true)", required: false },
            { name: "includeSocialProfiles", type: "boolean", description: "Include social profiles results (default: true)", required: false }
          ],
          response: `{
  "people": [ ... ],
  "groups": [ ... ],
  "interactions": [ ... ],
  "notes": [ ... ],
  "socialProfiles": [ ... ]
}`,
          example: `fetch('${baseUrl}/api/mega-search?q=project%20alpha')
  .then(res => res.json());`
        },
        {
          id: "get-social-graph",
          method: "POST",
          path: "/api/social-graph",
          summary: "Get computed network graph data",
          description: "Resolve node connections, grouping links, cluster hubs, and highlights configuration parameters.",
          body: `{
  "hideOrphans": true,
  "minConnections": 1,
  "mode": "default",
  "highlightedAccountId": null
}`,
          response: `{
  "nodes": [
    { "id": "node-1", "label": "johndoe", "val": 3, "color": "#e1306c" }
  ],
  "links": [
    { "source": "node-1", "target": "node-2" }
  ]
}`,
          example: `fetch('${baseUrl}/api/social-graph', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ hideOrphans: true })
}).then(res => res.json());`
        }
      ]
    },
    {
      id: "images",
      name: "Image Management",
      icon: ImageIcon,
      description: "Manage avatar pictures, local media caches, and trigger image-passing cascades.",
      endpoints: [
        {
          id: "upload-image",
          method: "POST",
          path: "/api/upload-image",
          summary: "Upload image file",
          description: "Uploads an image file to local storage or AWS S3.",
          body: `// Multipart Form Data:
// - image: file`,
          response: `{
  "imageUrl": "/api/images/photo-17195438.jpg"
}`,
          example: `const formData = new FormData();
formData.append('image', fileInput.files[0]);
fetch('${baseUrl}/api/upload-image', {
  method: 'POST',
  body: formData
}).then(res => res.json());`
        },
        {
          id: "image-pass-in",
          method: "POST",
          path: "/api/image-pass-in",
          summary: "Trigger image pass-in utility",
          description: "Automatically populates profile photos for contacts missing them if they are connected to social accounts that have valid pictures.",
          response: `{
  "totalPeopleWithoutImages": 24,
  "updated": 12,
  "skipped": 4,
  "updates": [
    { "personId": "uuid-1", "personName": "Alice Smith", "imageUrl": "https://..." }
  ]
}`,
          example: `fetch('${baseUrl}/api/image-pass-in', { method: 'POST' })
  .then(res => res.json());`
        }
      ]
    },
    {
      id: "metadata",
      name: "Metadata & Types",
      icon: BookMarked,
      description: "Manage customized category attributes, connection values, colors, and type registries.",
      endpoints: [
        {
          id: "get-social-account-types",
          method: "GET",
          path: "/api/social-account-types",
          summary: "List platform types",
          description: "Retrieve platforms configured (e.g. instagram, twitter, linkedin).",
          response: `[
  { "id": "instagram-type-uuid", "name": "instagram", "color": "#e1306c" }
]`,
          example: `fetch('${baseUrl}/api/social-account-types')
  .then(res => res.json());`
        },
        {
          id: "get-relationship-types",
          method: "GET",
          path: "/api/relationship-types",
          summary: "List relationship types",
          description: "Get customizable relation weights and attributes.",
          response: `[
  { "id": "type-uuid", "name": "Colleague", "value": 30, "color": "#f59e0b" }
]`,
          example: `fetch('${baseUrl}/api/relationship-types')
  .then(res => res.json());`
        }
      ]
    }
  ], [baseUrl]);

  // Search filtering logic
  const filteredCategories = useMemo(() => {
    return categories.map(category => {
      // If we are filtering by a specific category, skip others unless we're in 'all'
      if (selectedCategoryId !== "all" && category.id !== selectedCategoryId) {
        return { ...category, endpoints: [] };
      }

      // Filter endpoints inside the category
      const matchedEndpoints = category.endpoints.filter(ep => {
        const matchStr = `${ep.method} ${ep.path} ${ep.summary} ${ep.description}`.toLowerCase();
        return matchStr.includes(searchQuery.toLowerCase());
      });

      return {
        ...category,
        endpoints: matchedEndpoints
      };
    }).filter(category => category.endpoints.length > 0);
  }, [categories, searchQuery, selectedCategoryId]);

  const totalEndpointsCount = useMemo(() => {
    return categories.reduce((sum, cat) => sum + cat.endpoints.length, 0);
  }, [categories]);

  const getMethodColor = (method: string) => {
    switch (method) {
      case "GET":
        return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20";
      case "POST":
        return "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20";
      case "PATCH":
        return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20";
      case "PUT":
        return "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20";
      case "DELETE":
        return "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Premium Header Banner */}
      <div className="relative overflow-hidden border-b bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 px-6 py-8 text-white">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] opacity-20"></div>
        <div className="relative z-10 max-w-5xl flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-indigo-200 via-indigo-50 to-white bg-clip-text text-transparent flex items-center gap-3">
              <Terminal className="h-8 w-8 text-indigo-400" />
              PRM API Portal
            </h1>
            <p className="text-indigo-200/70 text-sm mt-1 max-w-xl">
              Build custom extensions, import pipelines, and automate integrations using our complete developer API reference guide.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <span className="text-xs text-indigo-300 font-mono bg-indigo-500/10 border border-indigo-500/20 rounded px-2.5 py-1">
              Base URL: {baseUrl}
            </span>
            <Button
              variant="secondary"
              size="sm"
              className="bg-indigo-650 text-white hover:bg-indigo-600 border-indigo-500/30"
              onClick={() => copyToClipboard(baseUrl, "base-url")}
            >
              {copiedEndpoint === "base-url" ? (
                <CheckCheck className="h-4 w-4 text-green-300 mr-1.5" />
              ) : (
                <Copy className="h-4 w-4 mr-1.5" />
              )}
              Copy URL
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar Pane */}
        <aside className="w-80 border-r bg-card/45 flex flex-col flex-shrink-0 hidden md:flex">
          {/* Quick Search */}
          <div className="p-4 border-b flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter endpoints (e.g. /api/people)..."
                className="pl-9 bg-background/50 focus-visible:ring-indigo-500"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Navigation Categories */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            <button
              onClick={() => setSelectedCategoryId("all")}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md transition-all ${
                selectedCategoryId === "all"
                  ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              <span className="flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                All Categories
              </span>
              <Badge variant="secondary" className="font-mono text-xs">
                {totalEndpointsCount}
              </Badge>
            </button>

            <div className="h-px bg-muted my-2" />

            {categories.map((category) => {
              const Icon = category.icon;
              return (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategoryId(category.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md transition-all ${
                    selectedCategoryId === category.id
                      ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {category.name}
                  </span>
                  <Badge variant="outline" className="font-mono text-xs opacity-60">
                    {category.endpoints.length}
                  </Badge>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Right Main Content Pane */}
        <main className="flex-1 flex flex-col overflow-hidden bg-muted/20">
          {/* Mobile view top filters */}
          <div className="p-4 border-b bg-background md:hidden flex flex-col gap-2">
            <div className="relative w-full">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search endpoints..."
                className="pl-9 bg-background/50"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              <Button
                variant={selectedCategoryId === "all" ? "default" : "outline"}
                size="sm"
                className="rounded-full text-xs"
                onClick={() => setSelectedCategoryId("all")}
              >
                All
              </Button>
              {categories.map((cat) => (
                <Button
                  key={cat.id}
                  variant={selectedCategoryId === cat.id ? "default" : "outline"}
                  size="sm"
                  className="rounded-full text-xs whitespace-nowrap"
                  onClick={() => setSelectedCategoryId(cat.id)}
                >
                  {cat.name}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 max-w-5xl w-full mx-auto">
            {/* Interactive Authentication Accordion Card */}
            <Card className="border-indigo-500/20 bg-gradient-to-b from-indigo-500/5 to-transparent hover-elevate">
              <button
                onClick={() => setIsAuthExpanded(!isAuthExpanded)}
                className="w-full p-4 flex items-center justify-between text-left"
              >
                <div className="flex items-center gap-3">
                  <Key className="h-5 w-5 text-indigo-500" />
                  <div>
                    <h3 className="text-md font-semibold text-foreground">Authentication Guide</h3>
                    <p className="text-xs text-muted-foreground">Learn how to authenticate requests via API Key or session cookies.</p>
                  </div>
                </div>
                {isAuthExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
              </button>

              {isAuthExpanded && (
                <CardContent className="border-t pt-4 space-y-4 text-sm text-muted-foreground">
                  <p>
                    PRM enforces route validation to secure your local CRM database. When building script hooks, cron sync processes, or Chrome extensions, you must authenticate each query using one of two strategies:
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-card p-4 rounded border">
                      <h4 className="font-semibold text-foreground mb-1 flex items-center gap-1.5">
                        <Badge variant="outline">Recommended</Badge> API Keys
                      </h4>
                      <p className="text-xs leading-relaxed mb-3">
                        Generate permanent tokens in user settings. Include the raw token in the request headers with the key <code className="font-mono text-foreground font-semibold">X-API-Key</code>.
                      </p>
                      <pre className="font-mono text-xs bg-muted p-2.5 rounded overflow-x-auto text-foreground">
{`curl -H "X-API-Key: your_key_here" \\
  ${baseUrl}/api/people`}
                      </pre>
                    </div>

                    <div className="bg-card p-4 rounded border">
                      <h4 className="font-semibold text-foreground mb-1 flex items-center gap-1.5">
                        <Badge variant="outline">Web UI</Badge> Session Cookies
                      </h4>
                      <p className="text-xs leading-relaxed mb-3">
                        Web interface pages use server-signed cookies containing encrypted session states. Ensure you post your username and password to log in first.
                      </p>
                      <pre className="font-mono text-xs bg-muted p-2.5 rounded overflow-x-auto text-foreground">
{`POST /api/login
Content-Type: application/json

{ "username": "admin", "password": "..." }`}
                      </pre>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>

            {/* List filtered Categories and Endpoints */}
            {filteredCategories.length === 0 ? (
              <div className="text-center py-12 bg-card border rounded-lg">
                <Database className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                <h3 className="text-lg font-medium text-foreground">No endpoints found</h3>
                <p className="text-sm text-muted-foreground mt-1">Try clearing your filters or typing another path search query.</p>
                <Button variant="outline" className="mt-4" onClick={() => { setSearchQuery(""); setSelectedCategoryId("all"); }}>
                  Reset Filters
                </Button>
              </div>
            ) : (
              filteredCategories.map((category) => (
                <div key={category.id} className="space-y-4">
                  <div className="flex items-center gap-2 pb-1 border-b">
                    <category.icon className="h-5 w-5 text-indigo-500 flex-shrink-0" />
                    <h2 className="text-xl font-bold tracking-tight text-foreground">{category.name}</h2>
                    <Badge variant="secondary" className="ml-2 font-mono text-xs">
                      {category.endpoints.length}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground -mt-1 leading-relaxed">
                    {category.description}
                  </p>

                  <div className="space-y-3">
                    {category.endpoints.map((endpoint) => {
                      const isExpanded = expandedEndpoints.has(endpoint.id);
                      return (
                        <Card 
                          key={endpoint.id} 
                          className="overflow-hidden hover-elevate transition-all border-l-4" 
                          style={{ borderLeftColor: endpoint.method === "GET" ? "#3b82f6" : endpoint.method === "POST" ? "#22c55e" : endpoint.method === "PATCH" ? "#f59e0b" : "#ef4444" }}
                        >
                          <button
                            onClick={() => toggleEndpoint(endpoint.id)}
                            className="w-full p-4 flex items-center justify-between text-left gap-4"
                          >
                            <div className="flex items-center gap-3 overflow-hidden flex-1">
                              <Badge className={`${getMethodColor(endpoint.method)} border font-mono font-bold flex-shrink-0`}>
                                {endpoint.method}
                              </Badge>
                              <code className="font-mono text-sm font-semibold text-foreground truncate select-all">
                                {endpoint.path}
                              </code>
                              <span className="text-sm text-muted-foreground truncate hidden sm:inline">
                                — {endpoint.summary}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground/60 hidden md:inline">
                                {isExpanded ? "Collapse" : "Expand"}
                              </span>
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                              )}
                            </div>
                          </button>

                          {isExpanded && (
                            <div className="px-4 pb-4 space-y-4 border-t pt-4 bg-muted/5">
                              <div>
                                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80 mb-1">Description</h4>
                                <p className="text-sm text-muted-foreground leading-relaxed">
                                  {endpoint.description}
                                </p>
                              </div>

                              {endpoint.queryParams && (
                                <div>
                                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80 mb-2">Query Parameters</h4>
                                  <div className="overflow-x-auto border rounded-md">
                                    <table className="w-full text-sm text-left border-collapse">
                                      <thead>
                                        <tr className="bg-muted/40 border-b">
                                          <th className="p-2 font-semibold">Parameter</th>
                                          <th className="p-2 font-semibold">Type</th>
                                          <th className="p-2 font-semibold">Requirement</th>
                                          <th className="p-2 font-semibold">Description</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {endpoint.queryParams.map((param) => (
                                          <tr key={param.name} className="border-b last:border-b-0 hover:bg-muted/20">
                                            <td className="p-2"><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{param.name}</code></td>
                                            <td className="p-2 text-xs text-muted-foreground font-mono">{param.type}</td>
                                            <td className="p-2 text-xs">
                                              {param.required ? (
                                                <Badge variant="destructive" className="text-[10px] leading-3 px-1 py-0 font-normal">Required</Badge>
                                              ) : (
                                                <Badge variant="secondary" className="text-[10px] leading-3 px-1 py-0 font-normal">Optional</Badge>
                                              )}
                                            </td>
                                            <td className="p-2 text-xs text-muted-foreground">{param.description}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}

                              {endpoint.body && (
                                <div>
                                  <div className="flex items-center justify-between mb-1.5">
                                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">Request Body</h4>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 px-2 hover:bg-muted"
                                      onClick={() => copyToClipboard(endpoint.body!, `${endpoint.id}-body`)}
                                    >
                                      {copiedEndpoint === `${endpoint.id}-body` ? (
                                        <CheckCheck className="h-3 w-3 text-green-600 mr-1" />
                                      ) : (
                                        <Copy className="h-3 w-3 mr-1" />
                                      )}
                                      Copy
                                    </Button>
                                  </div>
                                  <pre className="font-mono text-xs bg-slate-950 text-slate-100 p-4 rounded-md overflow-x-auto border border-slate-800">
                                    {endpoint.body}
                                  </pre>
                                </div>
                              )}

                              <div>
                                <div className="flex items-center justify-between mb-1.5">
                                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">Expected Response</h4>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 hover:bg-muted"
                                    onClick={() => copyToClipboard(endpoint.response, `${endpoint.id}-response`)}
                                  >
                                    {copiedEndpoint === `${endpoint.id}-response` ? (
                                      <CheckCheck className="h-3 w-3 text-green-600 mr-1" />
                                    ) : (
                                      <Copy className="h-3 w-3 mr-1" />
                                    )}
                                    Copy
                                  </Button>
                                </div>
                                <pre className="font-mono text-xs bg-slate-950 text-slate-100 p-4 rounded-md overflow-x-auto border border-slate-800">
                                  {endpoint.response}
                                </pre>
                              </div>

                              {endpoint.example && (
                                <div>
                                  <div className="flex items-center justify-between mb-1.5">
                                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">Fetch Integration Example</h4>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 px-2 hover:bg-muted"
                                      onClick={() => copyToClipboard(endpoint.example!, `${endpoint.id}-example`)}
                                    >
                                      {copiedEndpoint === `${endpoint.id}-example` ? (
                                        <CheckCheck className="h-3 w-3 text-green-600 mr-1" />
                                      ) : (
                                        <Copy className="h-3 w-3 mr-1" />
                                      )}
                                      Copy
                                    </Button>
                                  </div>
                                  <pre className="font-mono text-xs bg-slate-950 text-slate-100 p-4 rounded-md overflow-x-auto border border-slate-800">
                                    {endpoint.example}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
