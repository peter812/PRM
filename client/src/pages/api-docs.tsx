import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Copy, CheckCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export default function ApiDocs() {
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedEndpoint(id);
    setTimeout(() => setCopiedEndpoint(null), 2000);
  };

  const baseUrl = window.location.origin;

  const endpoints = [
    {
      id: "get-people",
      method: "GET",
      path: "/api/people",
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
    },
    {
      id: "get-person",
      method: "GET",
      path: "/api/people/:id",
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
    },
    {
      id: "create-person",
      method: "POST",
      path: "/api/people",
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
    },
    {
      id: "update-person",
      method: "PATCH",
      path: "/api/people/:id",
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
    },
    {
      id: "delete-person",
      method: "DELETE",
      path: "/api/people/:id",
      description: "Delete a person and all associated notes and interactions",
      response: `{ "success": true }`,
    },
    {
      id: "create-note",
      method: "POST",
      path: "/api/notes",
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
    },
    {
      id: "delete-note",
      method: "DELETE",
      path: "/api/notes/:id",
      description: "Delete a note",
      response: `{ "success": true }`,
    },
    {
      id: "create-interaction",
      method: "POST",
      path: "/api/interactions",
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
    },
    {
      id: "delete-interaction",
      method: "DELETE",
      path: "/api/interactions/:id",
      description: "Delete an interaction",
      response: `{ "success": true }`,
    },
    {
      id: "create-relationship",
      method: "POST",
      path: "/api/relationships",
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
    },
    {
      id: "update-relationship",
      method: "PATCH",
      path: "/api/relationships/:id",
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
    },
    {
      id: "delete-relationship",
      method: "DELETE",
      path: "/api/relationships/:id",
      description: "Delete a relationship",
      response: `{ "success": true }`,
    },
    {
      id: "get-groups",
      method: "GET",
      path: "/api/groups",
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
    },
    {
      id: "get-group",
      method: "GET",
      path: "/api/groups/:id",
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
    },
    {
      id: "create-group",
      method: "POST",
      path: "/api/groups",
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
    },
    {
      id: "update-group",
      method: "PATCH",
      path: "/api/groups/:id",
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
    },
    {
      id: "delete-group",
      method: "DELETE",
      path: "/api/groups/:id",
      description: "Delete a group and all associated notes",
      response: `{ "success": true }`,
    },
    {
      id: "create-group-note",
      method: "POST",
      path: "/api/group-notes",
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
    },
    {
      id: "delete-group-note",
      method: "DELETE",
      path: "/api/group-notes/:id",
      description: "Delete a group note",
      response: `{ "success": true }`,
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

        <div className="space-y-6">
          <h2 className="text-2xl font-semibold">Endpoints</h2>

          {endpoints.map((endpoint) => (
            <Card key={endpoint.id} className="p-6" data-testid={`card-endpoint-${endpoint.id}`}>
              <div className="flex items-start gap-3 mb-4">
                <Badge className={`${getMethodColor(endpoint.method)} border font-mono`}>
                  {endpoint.method}
                </Badge>
                <div className="flex-1">
                  <code className="font-mono text-sm font-medium">
                    {endpoint.path}
                  </code>
                  <p className="text-sm text-muted-foreground mt-1">
                    {endpoint.description}
                  </p>
                </div>
              </div>

              {endpoint.queryParams && (
                <div className="mb-4">
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
                <div className="mb-4">
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
            </Card>
          ))}
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
