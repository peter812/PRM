import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Copy, CheckCheck, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

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

  const endpoints = [
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
    "id": 1,
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "company": "Acme Corp",
    "title": "CEO",
    "tags": ["partner", "vip"],
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
]`,
      example: `// Get all people
fetch('${baseUrl}/api/people')
  .then(res => res.json())
  .then(data => console.log(data));

// Search for people
fetch('${baseUrl}/api/people?search=john')
  .then(res => res.json())
  .then(data => console.log(data));

// Get people with relationships
fetch('${baseUrl}/api/people?includeRelationships=true')
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
    {
      id: "get-person",
      method: "GET",
      path: "/api/people/:id",
      summary: "Get a single person",
      description: "Get a single person with all notes and interactions",
      response: `{
  "id": 1,
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "company": "Acme Corp",
  "title": "CEO",
  "tags": ["partner", "vip"],
  "createdAt": "2024-01-01T00:00:00.000Z",
  "notes": [...],
  "interactions": [...]
}`,
      example: `// Get person with ID
const personId = '123e4567-e89b-12d3-a456-426614174000';
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
  "id": 1,
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
    phone: '+1234567890',
    company: 'Acme Corp',
    title: 'CEO',
    tags: ['partner', 'vip']
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
      description: "Update a person",
      body: `{
  "firstName": "Jane",
  "email": "jane@example.com"
}`,
      response: `{
  "id": 1,
  "firstName": "Jane",
  ...
}`,
      example: `// Update a person
const personId = '123e4567-e89b-12d3-a456-426614174000';
fetch(\`${baseUrl}/api/people/\${personId}\`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    firstName: 'Jane',
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
const personId = '123e4567-e89b-12d3-a456-426614174000';
fetch(\`${baseUrl}/api/people/\${personId}\`, {
  method: 'DELETE'
})
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
    {
      id: "create-note",
      method: "POST",
      path: "/api/notes",
      summary: "Create a note",
      description: "Create a new note for a person",
      body: `{
  "personId": 1,
  "content": "Met at conference, interested in partnership"
}`,
      response: `{
  "id": 1,
  "personId": 1,
  "content": "Met at conference...",
  "createdAt": "2024-01-01T00:00:00.000Z"
}`,
      example: `// Create a note for a person
fetch('${baseUrl}/api/notes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    personId: '123e4567-e89b-12d3-a456-426614174000',
    content: 'Met at conference, interested in partnership'
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
const noteId = '123e4567-e89b-12d3-a456-426614174000';
fetch(\`${baseUrl}/api/notes/\${noteId}\`, {
  method: 'DELETE'
})
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
    {
      id: "create-interaction",
      method: "POST",
      path: "/api/interactions",
      summary: "Create an interaction",
      description: "Create a new interaction for a person",
      body: `{
  "personId": 1,
  "type": "meeting",
  "date": "2024-01-15T10:00:00.000Z",
  "description": "Discussed Q1 partnership opportunities"
}`,
      response: `{
  "id": 1,
  "personId": 1,
  "type": "meeting",
  "date": "2024-01-15T10:00:00.000Z",
  "description": "Discussed Q1 partnership opportunities",
  "createdAt": "2024-01-01T00:00:00.000Z"
}`,
      example: `// Create an interaction
fetch('${baseUrl}/api/interactions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    personId: '123e4567-e89b-12d3-a456-426614174000',
    type: 'meeting',
    date: new Date().toISOString(),
    description: 'Discussed Q1 partnership opportunities'
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
const interactionId = '123e4567-e89b-12d3-a456-426614174000';
fetch(\`${baseUrl}/api/interactions/\${interactionId}\`, {
  method: 'DELETE'
})
  .then(res => res.json())
  .then(data => console.log(data));`,
    },
    {
      id: "create-relationship",
      method: "POST",
      path: "/api/relationships",
      summary: "Create a relationship",
      description: "Create a relationship between two people",
      body: `{
  "fromPersonId": "uuid-1",
  "toPersonId": "uuid-2",
  "level": "colleague",
  "notes": "Met at conference"
}`,
      response: `{
  "id": "uuid-3",
  "fromPersonId": "uuid-1",
  "toPersonId": "uuid-2",
  "level": "colleague",
  "notes": "Met at conference",
  "createdAt": "2024-01-01T00:00:00.000Z"
}`,
      example: `// Create a relationship
fetch('${baseUrl}/api/relationships', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fromPersonId: 'uuid-1',
    toPersonId: 'uuid-2',
    level: 'colleague',
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
      description: "Update a relationship",
      body: `{
  "level": "friend",
  "notes": "Now good friends"
}`,
      response: `{
  "id": "uuid-3",
  "fromPersonId": "uuid-1",
  "toPersonId": "uuid-2",
  "level": "friend",
  "notes": "Now good friends",
  "createdAt": "2024-01-01T00:00:00.000Z"
}`,
      example: `// Update a relationship
const relationshipId = 'uuid-3';
fetch(\`${baseUrl}/api/relationships/\${relationshipId}\`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    level: 'friend',
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
    "type": ["department", "technical"],
    "members": ["person-uuid-1", "person-uuid-2"],
    "createdAt": "2024-01-01T00:00:00.000Z"
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
      description: "Get a single group with all notes",
      response: `{
  "id": "uuid-1",
  "name": "Engineering Team",
  "color": "#3b82f6",
  "type": ["department", "technical"],
  "members": ["person-uuid-1", "person-uuid-2"],
  "createdAt": "2024-01-01T00:00:00.000Z",
  "notes": [
    {
      "id": "note-uuid-1",
      "groupId": "uuid-1",
      "content": "Kickoff meeting scheduled",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
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
  "type": ["department", "technical"],
  "members": ["person-uuid-1", "person-uuid-2"]
}`,
      response: `{
  "id": "uuid-1",
  "name": "Engineering Team",
  "color": "#3b82f6",
  "type": ["department", "technical"],
  "members": ["person-uuid-1", "person-uuid-2"],
  "createdAt": "2024-01-01T00:00:00.000Z"
}`,
      example: `// Create a new group
fetch('${baseUrl}/api/groups', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Engineering Team',
    color: '#3b82f6',
    type: ['department', 'technical'],
    members: ['person-uuid-1', 'person-uuid-2']
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
      description: "Update a group",
      body: `{
  "name": "Senior Engineering Team",
  "members": ["person-uuid-1", "person-uuid-2", "person-uuid-3"]
}`,
      response: `{
  "id": "uuid-1",
  "name": "Senior Engineering Team",
  "color": "#3b82f6",
  "type": ["department", "technical"],
  "members": ["person-uuid-1", "person-uuid-2", "person-uuid-3"],
  "createdAt": "2024-01-01T00:00:00.000Z"
}`,
      example: `// Update a group
const groupId = 'uuid-1';
fetch(\`${baseUrl}/api/groups/\${groupId}\`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Senior Engineering Team',
    members: ['person-uuid-1', 'person-uuid-2', 'person-uuid-3']
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
    content: 'Kickoff meeting scheduled for next Monday'
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
          <h2 className="text-2xl font-semibold">Endpoints</h2>

          {endpoints.map((endpoint) => {
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
          })}
        </div>

        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">Reference Values</h2>
          
          <div className="mb-6">
            <h3 className="text-sm font-medium mb-2">Interaction Types</h3>
            <p className="text-sm text-muted-foreground mb-2">
              Valid values for the <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">type</code> field in interactions:
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">meeting</Badge>
              <Badge variant="secondary">call</Badge>
              <Badge variant="secondary">email</Badge>
              <Badge variant="secondary">other</Badge>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium mb-2">Relationship Levels</h3>
            <p className="text-sm text-muted-foreground mb-2">
              Valid values for the <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">level</code> field in relationships:
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">colleague</Badge>
              <Badge variant="secondary">friend</Badge>
              <Badge variant="secondary">family</Badge>
              <Badge variant="secondary">client</Badge>
              <Badge variant="secondary">partner</Badge>
              <Badge variant="secondary">mentor</Badge>
              <Badge variant="secondary">other</Badge>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
