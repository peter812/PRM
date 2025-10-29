import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Copy, CheckCheck, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface Endpoint {
  id: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  queryParams?: Array<{ name: string; type: string; description: string }>;
  body?: string;
  response: string;
  example?: string;
}

export default function ApiDocs() {
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null);
  const [expandedEndpoints, setExpandedEndpoints] = useState<Set<string>>(new Set());

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

  // People endpoints
  const peopleEndpoints: Endpoint[] = [
    {
      id: "get-people",
      method: "GET",
      path: "/api/people",
      summary: "Get all people",
      description: "Get all people with optional search query",
      queryParams: [
        { name: "search", type: "string", description: "Search by name, company, email, or tags" },
        { name: "includeRelationships", type: "boolean", description: "Include relationships in the response (default: false)" },
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
    "tags": ["partner", "vip"]
  }
]`,
      example: `// Get all people
fetch('${baseUrl}/api/people')
  .then(res => res.json())
  .then(data => console.log(data));

// Search for people
fetch('${baseUrl}/api/people?search=john')
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
    {
      id: "get-person",
      method: "GET",
      path: "/api/people/:id",
      summary: "Get a single person",
      description: "Get a single person with all notes, interactions, relationships, and groups",
      response: `{
  "id": "uuid-1",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "notes": [...],
  "interactions": [...],
  "relationships": [...],
  "groups": [...]
}`,
      example: `// Get person with ID
const personId = 'uuid-1';
fetch(\`${baseUrl}/api/people/\${personId}\`)
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
    {
      id: "create-person",
      method: "POST",
      path: "/api/people",
      summary: "Create a new person",
      description: "Create a new person",
      body: `{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "company": "Acme Corp",
  "title": "CEO",
  "tags": ["partner", "vip"]
}`,
      response: `{
  "id": "uuid-1",
  "firstName": "John",
  "lastName": "Doe",
  ...
}`,
      example: `// Create a new person
fetch('${baseUrl}/api/people', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    company: 'Acme Corp'
  })
})
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
    {
      id: "update-person",
      method: "PATCH",
      path: "/api/people/:id",
      summary: "Update a person",
      description: "Update a person's information",
      body: `{
  "firstName": "Jane",
  "email": "jane@example.com"
}`,
      response: `{
  "id": "uuid-1",
  "firstName": "Jane",
  ...
}`,
      example: `// Update a person
const personId = 'uuid-1';
fetch(\`${baseUrl}/api/people/\${personId}\`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'jane@example.com'
  })
})
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
    {
      id: "delete-person",
      method: "DELETE",
      path: "/api/people/:id",
      summary: "Delete a person",
      description: "Delete a person and all associated notes and interactions",
      response: `{ "success": true }`,
      example: `// Delete a person
const personId = 'uuid-1';
fetch(\`${baseUrl}/api/people/\${personId}\`, {
  method: 'DELETE'
})
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
  ];

  // Notes endpoints
  const notesEndpoints: Endpoint[] = [
    {
      id: "create-note",
      method: "POST",
      path: "/api/notes",
      summary: "Create a note",
      description: "Create a new note for a person",
      body: `{
  "personId": "uuid-1",
  "content": "Met at conference, interested in partnership"
}`,
      response: `{
  "id": "uuid-2",
  "personId": "uuid-1",
  "content": "Met at conference...",
  "createdAt": "2024-01-01T00:00:00.000Z"
}`,
      example: `// Create a note for a person
fetch('${baseUrl}/api/notes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    personId: 'uuid-1',
    content: 'Met at conference'
  })
})
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
    {
      id: "delete-note",
      method: "DELETE",
      path: "/api/notes/:id",
      summary: "Delete a note",
      description: "Delete a note",
      response: `{ "success": true }`,
      example: `// Delete a note
const noteId = 'uuid-2';
fetch(\`${baseUrl}/api/notes/\${noteId}\`, {
  method: 'DELETE'
})
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
  ];

  // Interactions endpoints
  const interactionsEndpoints: Endpoint[] = [
    {
      id: "create-interaction",
      method: "POST",
      path: "/api/interactions",
      summary: "Create an interaction",
      description: "Create a new interaction involving multiple people and optional groups",
      body: `{
  "peopleIds": ["uuid-1", "uuid-2"],
  "groupIds": [],
  "type": "meeting",
  "date": "2024-01-15T10:00:00.000Z",
  "description": "Discussed Q1 partnership opportunities"
}`,
      response: `{
  "id": "uuid-3",
  "peopleIds": ["uuid-1", "uuid-2"],
  "type": "meeting",
  "date": "2024-01-15T10:00:00.000Z",
  "description": "Discussed Q1 partnership opportunities"
}`,
      example: `// Create an interaction
fetch('${baseUrl}/api/interactions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    peopleIds: ['uuid-1', 'uuid-2'],
    type: 'meeting',
    date: new Date().toISOString(),
    description: 'Discussed partnership'
  })
})
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
    {
      id: "delete-interaction",
      method: "DELETE",
      path: "/api/interactions/:id",
      summary: "Delete an interaction",
      description: "Delete an interaction",
      response: `{ "success": true }`,
      example: `// Delete an interaction
const interactionId = 'uuid-3';
fetch(\`${baseUrl}/api/interactions/\${interactionId}\`, {
  method: 'DELETE'
})
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
  ];

  // Relationships endpoints
  const relationshipsEndpoints: Endpoint[] = [
    {
      id: "create-relationship",
      method: "POST",
      path: "/api/relationships",
      summary: "Create a relationship",
      description: "Create a relationship between two people",
      body: `{
  "fromPersonId": "uuid-1",
  "toPersonId": "uuid-2",
  "typeId": "relationship-type-uuid",
  "notes": "Met at conference"
}`,
      response: `{
  "id": "uuid-3",
  "fromPersonId": "uuid-1",
  "toPersonId": "uuid-2",
  "typeId": "relationship-type-uuid",
  "notes": "Met at conference"
}`,
      example: `// Create a relationship
fetch('${baseUrl}/api/relationships', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fromPersonId: 'uuid-1',
    toPersonId: 'uuid-2',
    typeId: 'relationship-type-uuid',
    notes: 'Met at conference'
  })
})
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
    {
      id: "update-relationship",
      method: "PATCH",
      path: "/api/relationships/:id",
      summary: "Update a relationship",
      description: "Update a relationship's notes",
      body: `{
  "notes": "Now good friends"
}`,
      response: `{
  "id": "uuid-3",
  "notes": "Now good friends",
  ...
}`,
      example: `// Update a relationship
const relationshipId = 'uuid-3';
fetch(\`${baseUrl}/api/relationships/\${relationshipId}\`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    notes: 'Now good friends'
  })
})
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
    {
      id: "delete-relationship",
      method: "DELETE",
      path: "/api/relationships/:id",
      summary: "Delete a relationship",
      description: "Delete a relationship",
      response: `{ "success": true }`,
      example: `// Delete a relationship
const relationshipId = 'uuid-3';
fetch(\`${baseUrl}/api/relationships/\${relationshipId}\`, {
  method: 'DELETE'
})
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
  ];

  // Groups endpoints
  const groupsEndpoints: Endpoint[] = [
    {
      id: "get-groups",
      method: "GET",
      path: "/api/groups",
      summary: "Get all groups",
      description: "Get all groups",
      response: `[
  {
    "id": "uuid-1",
    "name": "Engineering Team",
    "color": "#3b82f6",
    "members": ["person-uuid-1", "person-uuid-2"]
  }
]`,
      example: `// Get all groups
fetch('${baseUrl}/api/groups')
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
    {
      id: "get-group",
      method: "GET",
      path: "/api/groups/:id",
      summary: "Get a single group",
      description: "Get a single group with all notes and members",
      response: `{
  "id": "uuid-1",
  "name": "Engineering Team",
  "color": "#3b82f6",
  "members": ["person-uuid-1"],
  "notes": [...],
  "interactions": [...]
}`,
      example: `// Get group with ID
const groupId = 'uuid-1';
fetch(\`${baseUrl}/api/groups/\${groupId}\`)
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
    {
      id: "create-group",
      method: "POST",
      path: "/api/groups",
      summary: "Create a new group",
      description: "Create a new group",
      body: `{
  "name": "Engineering Team",
  "color": "#3b82f6",
  "members": ["person-uuid-1", "person-uuid-2"]
}`,
      response: `{
  "id": "uuid-1",
  "name": "Engineering Team",
  "color": "#3b82f6",
  "members": ["person-uuid-1", "person-uuid-2"]
}`,
      example: `// Create a new group
fetch('${baseUrl}/api/groups', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Engineering Team',
    color: '#3b82f6',
    members: ['person-uuid-1']
  })
})
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
    {
      id: "update-group",
      method: "PATCH",
      path: "/api/groups/:id",
      summary: "Update a group",
      description: "Update a group's name, color, or members",
      body: `{
  "name": "Senior Engineering Team",
  "members": ["person-uuid-1", "person-uuid-2"]
}`,
      response: `{
  "id": "uuid-1",
  "name": "Senior Engineering Team",
  ...
}`,
      example: `// Update a group
const groupId = 'uuid-1';
fetch(\`${baseUrl}/api/groups/\${groupId}\`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Senior Engineering Team'
  })
})
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
    {
      id: "delete-group",
      method: "DELETE",
      path: "/api/groups/:id",
      summary: "Delete a group",
      description: "Delete a group and all associated notes",
      response: `{ "success": true }`,
      example: `// Delete a group
const groupId = 'uuid-1';
fetch(\`${baseUrl}/api/groups/\${groupId}\`, {
  method: 'DELETE'
})
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
  ];

  // Group Notes endpoints
  const groupNotesEndpoints: Endpoint[] = [
    {
      id: "create-group-note",
      method: "POST",
      path: "/api/group-notes",
      summary: "Create a group note",
      description: "Create a new note for a group",
      body: `{
  "groupId": "uuid-1",
  "content": "Kickoff meeting scheduled for next Monday"
}`,
      response: `{
  "id": "note-uuid-1",
  "groupId": "uuid-1",
  "content": "Kickoff meeting scheduled for next Monday",
  "createdAt": "2024-01-01T00:00:00.000Z"
}`,
      example: `// Create a note for a group
fetch('${baseUrl}/api/group-notes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    groupId: 'uuid-1',
    content: 'Kickoff meeting scheduled'
  })
})
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
    {
      id: "delete-group-note",
      method: "DELETE",
      path: "/api/group-notes/:id",
      summary: "Delete a group note",
      description: "Delete a group note",
      response: `{ "success": true }`,
      example: `// Delete a group note
const noteId = 'note-uuid-1';
fetch(\`${baseUrl}/api/group-notes/\${noteId}\`, {
  method: 'DELETE'
})
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
  ];

  const getMethodColor = (method: string) => {
    switch (method) {
      case "GET":
        return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20";
      case "POST":
        return "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20";
      case "PATCH":
        return "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20";
      case "DELETE":
        return "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const renderEndpoint = (endpoint: Endpoint) => {
    const isExpanded = expandedEndpoints.has(endpoint.id);

    return (
      <Card 
        key={endpoint.id} 
        className="overflow-hidden hover-elevate active-elevate-2" 
        data-testid={`card-endpoint-${endpoint.id}`}
      >
        <button
          onClick={() => toggleEndpoint(endpoint.id)}
          className="w-full p-4 flex items-center gap-3 text-left"
          data-testid={`button-toggle-${endpoint.id}`}
        >
          {isExpanded ? (
            <ChevronDown className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          )}
          <Badge className={`${getMethodColor(endpoint.method)} border font-mono flex-shrink-0`}>
            {endpoint.method}
          </Badge>
          <code className="font-mono text-sm font-medium flex-shrink-0">
            {endpoint.path}
          </code>
          <span className="text-sm text-muted-foreground truncate">
            {endpoint.summary}
          </span>
        </button>

        {isExpanded && (
          <div className="px-4 pb-4 space-y-4 border-t pt-4">
            <p className="text-sm text-muted-foreground">
              {endpoint.description}
            </p>

            {endpoint.queryParams && (
              <div>
                <h4 className="text-sm font-medium mb-2">Query Parameters</h4>
                <div className="space-y-2">
                  {endpoint.queryParams.map((param) => (
                    <div
                      key={param.name}
                      className="flex items-start gap-2 text-sm"
                    >
                      <code className="font-mono text-xs bg-muted px-2 py-1 rounded">
                        {param.name}
                      </code>
                      <span className="text-muted-foreground text-xs">
                        ({param.type})
                      </span>
                      <span className="text-muted-foreground">-</span>
                      <span>{param.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {endpoint.body && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium">Request Body</h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      copyToClipboard(endpoint.body!, `${endpoint.id}-body`)
                    }
                    data-testid={`button-copy-body-${endpoint.id}`}
                  >
                    {copiedEndpoint === `${endpoint.id}-body` ? (
                      <CheckCheck className="h-3 w-3 text-green-600" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                </div>
                <pre className="font-mono text-xs bg-muted p-4 rounded overflow-x-auto">
                  {endpoint.body}
                </pre>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium">Response</h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    copyToClipboard(endpoint.response, `${endpoint.id}-response`)
                  }
                  data-testid={`button-copy-response-${endpoint.id}`}
                >
                  {copiedEndpoint === `${endpoint.id}-response` ? (
                    <CheckCheck className="h-3 w-3 text-green-600" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
              <pre className="font-mono text-xs bg-muted p-4 rounded overflow-x-auto">
                {endpoint.response}
              </pre>
            </div>

            {endpoint.example && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium">Example API Call</h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      copyToClipboard(endpoint.example!, `${endpoint.id}-example`)
                    }
                    data-testid={`button-copy-example-${endpoint.id}`}
                  >
                    {copiedEndpoint === `${endpoint.id}-example` ? (
                      <CheckCheck className="h-3 w-3 text-green-600" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                </div>
                <pre className="font-mono text-xs bg-muted p-4 rounded overflow-x-auto">
                  {endpoint.example}
                </pre>
              </div>
            )}
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="border-b px-6 py-6">
        <h1 className="text-3xl font-semibold mb-2" data-testid="text-api-title">
          API Documentation
        </h1>
        <p className="text-muted-foreground">
          RESTful API endpoints for programmatic access to your people data
        </p>
      </div>

      <div className="px-6 py-6 space-y-6 max-w-5xl">
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-2">Base URL</h2>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-sm bg-muted px-3 py-2 rounded">
              {baseUrl}
            </code>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => copyToClipboard(baseUrl, "base-url")}
              data-testid="button-copy-base-url"
            >
              {copiedEndpoint === "base-url" ? (
                <CheckCheck className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </Card>

        <div className="space-y-3">
          <h2 className="text-2xl font-semibold mb-4">Endpoints</h2>

          <Accordion type="multiple" className="space-y-3">
            <AccordionItem value="people" className="border rounded-lg px-4" data-testid="section-people">
              <AccordionTrigger className="text-lg font-semibold hover:no-underline">
                People
              </AccordionTrigger>
              <AccordionContent className="space-y-3 pt-3">
                {peopleEndpoints.map(renderEndpoint)}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="notes" className="border rounded-lg px-4" data-testid="section-notes">
              <AccordionTrigger className="text-lg font-semibold hover:no-underline">
                Notes
              </AccordionTrigger>
              <AccordionContent className="space-y-3 pt-3">
                {notesEndpoints.map(renderEndpoint)}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="interactions" className="border rounded-lg px-4" data-testid="section-interactions">
              <AccordionTrigger className="text-lg font-semibold hover:no-underline">
                Interactions
              </AccordionTrigger>
              <AccordionContent className="space-y-3 pt-3">
                {interactionsEndpoints.map(renderEndpoint)}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="relationships" className="border rounded-lg px-4" data-testid="section-relationships">
              <AccordionTrigger className="text-lg font-semibold hover:no-underline">
                Relationships
              </AccordionTrigger>
              <AccordionContent className="space-y-3 pt-3">
                {relationshipsEndpoints.map(renderEndpoint)}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="groups" className="border rounded-lg px-4" data-testid="section-groups">
              <AccordionTrigger className="text-lg font-semibold hover:no-underline">
                Groups
              </AccordionTrigger>
              <AccordionContent className="space-y-3 pt-3">
                {groupsEndpoints.map(renderEndpoint)}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="group-notes" className="border rounded-lg px-4" data-testid="section-group-notes">
              <AccordionTrigger className="text-lg font-semibold hover:no-underline">
                Group Notes
              </AccordionTrigger>
              <AccordionContent className="space-y-3 pt-3">
                {groupNotesEndpoints.map(renderEndpoint)}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>
    </div>
  );
}
