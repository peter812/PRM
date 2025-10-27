import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { Person } from "@shared/schema";
import { AddPersonDialog } from "@/components/add-person-dialog";

export default function PeopleList() {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const { data: people, isLoading, isError, error } = useQuery<Person[]>({
    queryKey: ["/api/people"],
  });

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-semibold" data-testid="text-page-title">
            People
          </h1>
          <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-person">
            <Plus className="h-4 w-4" />
            Add Person
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="p-4 animate-pulse">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-1/3" />
                    <div className="h-3 bg-muted rounded w-1/4" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <Users className="h-8 w-8 text-destructive" />
            </div>
            <h3 className="text-lg font-medium mb-2">Failed to load people</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              {error?.message || "An error occurred while fetching people"}
            </p>
            <Button onClick={() => window.location.reload()} variant="outline" data-testid="button-retry">
              Try Again
            </Button>
          </div>
        ) : people && people.length > 0 ? (
          <div className="space-y-4">
            {people.map((person) => (
              <Link key={person.id} href={`/person/${person.id}`}>
                <Card
                  className="p-4 hover-elevate transition-all cursor-pointer"
                  data-testid={`card-person-${person.id}`}
                >
                  <div className="flex items-center gap-4">
                    <Avatar className="w-12 h-12">
                      {person.imageUrl && (
                        <AvatarImage src={person.imageUrl} alt={`${person.firstName} ${person.lastName}`} />
                      )}
                      <AvatarFallback>
                        {getInitials(person.firstName, person.lastName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-medium" data-testid={`text-name-${person.id}`}>
                        {person.firstName} {person.lastName}
                      </h3>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        {person.company && (
                          <span data-testid={`text-company-${person.id}`}>
                            {person.company}
                          </span>
                        )}
                        {person.title && person.company && <span>•</span>}
                        {person.title && (
                          <span data-testid={`text-title-${person.id}`}>
                            {person.title}
                          </span>
                        )}
                      </div>
                      {person.tags && person.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {person.tags.map((tag, idx) => (
                            <Badge key={idx} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No people found</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              Get started by adding your first contact
            </p>
            <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-person-empty">
              <Plus className="h-4 w-4" />
              Add Person
            </Button>
          </div>
        )}
      </div>

      <AddPersonDialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen} />
    </div>
  );
}

function Users(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
