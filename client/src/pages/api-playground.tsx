import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Resource = "people" | "notes" | "interactions" | "relationships" | "groups" | "group-notes";
type Operation = "list" | "get" | "create" | "update" | "delete";

interface ApiExample {
  code: string;
  description: string;
}

const API_BASE_URL = window.location.origin;

export default function ApiPlayground() {
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState("");
  const [resource, setResource] = useState<Resource | "">("");
  const [operation, setOperation] = useState<Operation | "">("");
  const [result, setResult] = useState<string>("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [editableCode, setEditableCode] = useState<string>("");

  const getAvailableOperations = (resource: Resource): Operation[] => {
    switch (resource) {
      case "people":
        return ["list", "get", "create", "update", "delete"];
      case "notes":
        return ["list", "create", "delete"];
      case "interactions":
        return ["list", "create", "delete"];
      case "relationships":
        return ["get", "create", "update", "delete"];
      case "groups":
        return ["list", "get", "create", "update", "delete"];
      case "group-notes":
        return ["get", "create", "delete"];
      default:
        return [];
    }
  };

  const generateExample = (resource: Resource, operation: Operation): ApiExample | null => {
    const examples: Record<string, Record<string, ApiExample>> = {
      people: {
        list: {
          description: "Fetch all people",
          code: `fetch('${API_BASE_URL}/api/people', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        },
        get: {
          description: "Get a specific person by ID",
          code: `const personId = 'PERSON_ID_HERE';

fetch(\`${API_BASE_URL}/api/people/\${personId}\`, {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        },
        create: {
          description: "Create a new person",
          code: `const newPerson = {
  firstName: 'John',
  lastName: 'Doe',
  email: 'john.doe@example.com',
  phone: '+1234567890',
  company: 'Acme Inc',
  title: 'Software Engineer',
  tags: ['client', 'important']
};

fetch('${API_BASE_URL}/api/people', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(newPerson)
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        },
        update: {
          description: "Update an existing person",
          code: `const personId = 'PERSON_ID_HERE';
const updates = {
  email: 'newemail@example.com',
  title: 'Senior Software Engineer'
};

fetch(\`${API_BASE_URL}/api/people/\${personId}\`, {
  method: 'PATCH',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(updates)
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        },
        delete: {
          description: "Delete a person",
          code: `const personId = 'PERSON_ID_HERE';

fetch(\`${API_BASE_URL}/api/people/\${personId}\`, {
  method: 'DELETE',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        }
      },
      notes: {
        list: {
          description: "Get all notes across all people",
          code: `fetch('${API_BASE_URL}/api/notes', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        },
        create: {
          description: "Create a note for a person",
          code: `const newNote = {
  personId: 'PERSON_ID_HERE',
  content: 'Met at conference, interested in our product'
};

fetch('${API_BASE_URL}/api/notes', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(newNote)
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        },
        delete: {
          description: "Delete a note",
          code: `const noteId = 'NOTE_ID_HERE';

fetch(\`${API_BASE_URL}/api/notes/\${noteId}\`, {
  method: 'DELETE',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        }
      },
      interactions: {
        list: {
          description: "Get filtered interactions for a person or group",
          code: `// Get interactions for a person (last 10)
const params = new URLSearchParams({
  interaction_type: 'person',
  uuid: 'PERSON_ID_HERE',
  count_limit: '10'
});

fetch(\`${API_BASE_URL}/api/interactions?\${params}\`, {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));

// Get interactions for a group after a specific date
const params2 = new URLSearchParams({
  interaction_type: 'group',
  uuid: 'GROUP_ID_HERE',
  date_back: '2024-01-01T00:00:00.000Z'
});

fetch(\`${API_BASE_URL}/api/interactions?\${params2}\`, {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        },
        create: {
          description: "Create an interaction (meeting, call, email, etc.)",
          code: `const newInteraction = {
  peopleIds: ['PERSON_ID_1', 'PERSON_ID_2'],
  groupIds: [],
  type: 'meeting',
  date: new Date().toISOString(),
  description: 'Discussed project timeline and deliverables'
};

fetch('${API_BASE_URL}/api/interactions', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(newInteraction)
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        },
        delete: {
          description: "Delete an interaction",
          code: `const interactionId = 'INTERACTION_ID_HERE';

fetch(\`${API_BASE_URL}/api/interactions/\${interactionId}\`, {
  method: 'DELETE',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        }
      },
      relationships: {
        get: {
          description: "Get relationships for a person with optional filters",
          code: `// Get all relationships for a person
const personId = 'PERSON_ID_HERE';

fetch(\`${API_BASE_URL}/api/relationships/\${personId}\`, {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));

// Get top 5 relationships with value >= 70
const params = new URLSearchParams({
  count_limit: '5',
  value_limit: '70'
});

fetch(\`${API_BASE_URL}/api/relationships/\${personId}?\${params}\`, {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        },
        create: {
          description: "Create a relationship between two people",
          code: `const newRelationship = {
  fromPersonId: 'PERSON_ID_1',
  toPersonId: 'PERSON_ID_2',
  typeId: 'RELATIONSHIP_TYPE_ID',
  notes: 'Met through mutual friend'
};

fetch('${API_BASE_URL}/api/relationships', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(newRelationship)
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        },
        update: {
          description: "Update a relationship",
          code: `const relationshipId = 'RELATIONSHIP_ID_HERE';
const updates = {
  notes: 'Updated notes about the relationship'
};

fetch(\`${API_BASE_URL}/api/relationships/\${relationshipId}\`, {
  method: 'PATCH',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(updates)
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        },
        delete: {
          description: "Delete a relationship",
          code: `const relationshipId = 'RELATIONSHIP_ID_HERE';

fetch(\`${API_BASE_URL}/api/relationships/\${relationshipId}\`, {
  method: 'DELETE',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        }
      },
      groups: {
        list: {
          description: "Fetch all groups",
          code: `fetch('${API_BASE_URL}/api/groups', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        },
        get: {
          description: "Get a specific group by ID",
          code: `const groupId = 'GROUP_ID_HERE';

fetch(\`${API_BASE_URL}/api/groups/\${groupId}\`, {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        },
        create: {
          description: "Create a new group",
          code: `const newGroup = {
  name: 'Product Team',
  color: '#3b82f6',
  members: ['PERSON_ID_1', 'PERSON_ID_2']
};

fetch('${API_BASE_URL}/api/groups', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(newGroup)
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        },
        update: {
          description: "Update an existing group",
          code: `const groupId = 'GROUP_ID_HERE';
const updates = {
  name: 'Updated Team Name',
  color: '#8b5cf6'
};

fetch(\`${API_BASE_URL}/api/groups/\${groupId}\`, {
  method: 'PATCH',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(updates)
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        },
        delete: {
          description: "Delete a group",
          code: `const groupId = 'GROUP_ID_HERE';

fetch(\`${API_BASE_URL}/api/groups/\${groupId}\`, {
  method: 'DELETE',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        }
      },
      "group-notes": {
        get: {
          description: "Get notes for a group with optional filters",
          code: `// Get all notes for a group
const groupId = 'GROUP_ID_HERE';

fetch(\`${API_BASE_URL}/api/group-notes/\${groupId}\`, {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));

// Get last 10 notes created after a specific date
const params = new URLSearchParams({
  count_limit: '10',
  date_back: '2024-01-01T00:00:00.000Z'
});

fetch(\`${API_BASE_URL}/api/group-notes/\${groupId}?\${params}\`, {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        },
        create: {
          description: "Create a note for a group",
          code: `const newGroupNote = {
  groupId: 'GROUP_ID_HERE',
  content: 'Quarterly planning meeting scheduled for next week'
};

fetch('${API_BASE_URL}/api/group-notes', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(newGroupNote)
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        },
        delete: {
          description: "Delete a group note",
          code: `const groupNoteId = 'GROUP_NOTE_ID_HERE';

fetch(\`${API_BASE_URL}/api/group-notes/\${groupNoteId}\`, {
  method: 'DELETE',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`
        }
      }
    };

    return examples[resource]?.[operation] || null;
  };

  const example = resource && operation ? generateExample(resource, operation) : null;

  // Update editable code when example changes
  useEffect(() => {
    if (example) {
      setEditableCode(example.code);
    }
  }, [example]);

  const executeApiCall = async () => {
    if (!apiKey) {
      toast({
        title: "API Key Required",
        description: "Please enter your API key to execute API calls",
        variant: "destructive",
      });
      return;
    }

    if (!resource || !operation) {
      toast({
        title: "Selection Required",
        description: "Please select both a resource and operation",
        variant: "destructive",
      });
      return;
    }

    if (!editableCode) {
      toast({
        title: "Error",
        description: "No code available to execute",
        variant: "destructive",
      });
      return;
    }

    setIsExecuting(true);
    setResult("Executing...");

    try {
      // Replace YOUR_API_KEY with the actual API key in the code
      const codeToExecute = editableCode.replace(/YOUR_API_KEY/g, apiKey);
      
      // Execute the code and capture the result
      const resultPromise = new Promise((resolve, reject) => {
        // Create a safe execution environment
        const originalConsoleLog = console.log;
        const originalConsoleError = console.error;
        
        let capturedResult: any = null;
        
        console.log = (...args: any[]) => {
          capturedResult = args.length === 1 ? args[0] : args;
          originalConsoleLog(...args);
        };
        
        console.error = (...args: any[]) => {
          capturedResult = { error: args.length === 1 ? args[0] : args };
          originalConsoleError(...args);
        };

        try {
          // Use Function constructor to execute the code
          const asyncFunc = new Function('fetch', `
            return (async () => {
              ${codeToExecute}
            })();
          `);
          
          asyncFunc(fetch).then(() => {
            setTimeout(() => {
              console.log = originalConsoleLog;
              console.error = originalConsoleError;
              resolve(capturedResult);
            }, 500);
          }).catch((error: any) => {
            console.log = originalConsoleLog;
            console.error = originalConsoleError;
            reject(error);
          });
        } catch (error) {
          console.log = originalConsoleLog;
          console.error = originalConsoleError;
          reject(error);
        }
      });

      const data = await resultPromise;
      setResult(JSON.stringify(data, null, 2));
    } catch (error: any) {
      setResult(JSON.stringify({ error: error.message || "An error occurred" }, null, 2));
      toast({
        title: "Execution Error",
        description: error.message || "Failed to execute API call",
        variant: "destructive",
      });
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="border-b px-12 py-6">
        <h1 className="text-3xl font-bold mb-2">API Playground</h1>
        <p className="text-muted-foreground">
          Test and demo API calls to your People Management CRM
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-12 py-6 space-y-6">
        <Card className="p-6">
          <div className="space-y-4">
            <div>
              <Label htmlFor="api-key">API Key</Label>
              <Input
                id="api-key"
                type="password"
                placeholder="Enter your API key from Settings > API Settings"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="mt-1.5"
                data-testid="input-api-key"
              />
              <p className="text-sm text-muted-foreground mt-1.5">
                Generate an API key from Settings → API Settings to test the API
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="resource">I want to interact with</Label>
                <Select
                  value={resource}
                  onValueChange={(value) => {
                    setResource(value as Resource);
                    setOperation("");
                    setResult("");
                  }}
                >
                  <SelectTrigger id="resource" className="mt-1.5" data-testid="select-resource">
                    <SelectValue placeholder="Select a resource" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="people">People</SelectItem>
                    <SelectItem value="notes">Notes</SelectItem>
                    <SelectItem value="interactions">Interactions</SelectItem>
                    <SelectItem value="relationships">Relationships</SelectItem>
                    <SelectItem value="groups">Groups</SelectItem>
                    <SelectItem value="group-notes">Group Notes</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="operation">I want to</Label>
                <Select
                  value={operation}
                  onValueChange={(value) => {
                    setOperation(value as Operation);
                    setResult("");
                  }}
                  disabled={!resource}
                >
                  <SelectTrigger id="operation" className="mt-1.5" data-testid="select-operation">
                    <SelectValue placeholder="Select an operation" />
                  </SelectTrigger>
                  <SelectContent>
                    {resource && getAvailableOperations(resource as Resource).map((op) => (
                      <SelectItem key={op} value={op}>
                        {op.charAt(0).toUpperCase() + op.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </Card>

        {example && (
          <>
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-3">{example.description}</h2>
              <div className="mb-2">
                <Label htmlFor="editable-code" className="text-sm text-muted-foreground">
                  Edit the code below to customize parameters
                </Label>
              </div>
              <Textarea
                id="editable-code"
                value={editableCode}
                onChange={(e) => setEditableCode(e.target.value)}
                className="font-mono text-sm min-h-[300px] resize-y"
                data-testid="textarea-code"
              />
              <div className="mt-4 flex justify-end">
                <Button
                  onClick={executeApiCall}
                  disabled={isExecuting || !apiKey}
                  data-testid="button-execute"
                >
                  <Play className="h-4 w-4 mr-2" />
                  {isExecuting ? "Executing..." : "Run"}
                </Button>
              </div>
            </Card>

            {result && (
              <Card className="p-6">
                <h2 className="text-lg font-semibold mb-3">Result</h2>
                <pre className="bg-muted p-4 rounded-md overflow-x-auto text-sm max-h-96 overflow-y-auto">
                  <code data-testid="result-output">{result}</code>
                </pre>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
