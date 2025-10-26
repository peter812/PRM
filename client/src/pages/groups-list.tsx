import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, LayoutList, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AddGroupDialog } from "@/components/add-group-dialog";
import type { Group } from "@shared/schema";

type ViewMode = "list" | "wide";

export default function GroupsList() {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // Set default view based on screen size
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setViewMode("wide");
      } else {
        setViewMode("list");
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const { data: groups, isLoading } = useQuery<Group[]>({
    queryKey: ["/api/groups"],
  });

  const getInitials = (name: string) => {
    const words = name.split(" ");
    if (words.length >= 2) {
      return `${words[0][0]}${words[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h1 className="text-3xl font-semibold" data-testid="text-page-title">
            Groups
          </h1>
          <div className="flex items-center gap-2">
            <div className="flex items-center border rounded-md p-1">
              <Button
                variant={viewMode === "list" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("list")}
                className="h-8"
                data-testid="button-view-list"
              >
                <LayoutList className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "wide" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("wide")}
                className="h-8"
                data-testid="button-view-wide"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
            </div>
            <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-group">
              <Plus className="h-4 w-4" />
              Add Group
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6">
        {isLoading ? (
          <div className={viewMode === "list" ? "space-y-3" : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"}>
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
        ) : groups && groups.length > 0 ? (
          viewMode === "list" ? (
            <div className="space-y-3">
              {groups.map((group) => (
                <Card
                  key={group.id}
                  className="p-4 hover-elevate transition-all cursor-pointer"
                  data-testid={`card-group-${group.id}`}
                >
                  <div className="flex items-center gap-4">
                    <Avatar className="w-12 h-12" style={{ borderColor: group.color }}>
                      {group.imageUrl && (
                        <AvatarImage src={group.imageUrl} alt={group.name} />
                      )}
                      <AvatarFallback style={{ backgroundColor: `${group.color}20` }}>
                        {getInitials(group.name)}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="text-lg font-medium" data-testid={`text-name-${group.id}`}>
                          {group.name}
                        </h3>
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: group.color }}
                          data-testid={`color-indicator-${group.id}`}
                        />
                      </div>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <span data-testid={`text-member-count-${group.id}`}>
                          {group.members?.length || 0} members
                        </span>
                        {group.type && group.type.length > 0 && (
                          <>
                            <span>•</span>
                            <div className="flex flex-wrap gap-1">
                              {group.type.map((type, idx) => (
                                <Badge key={idx} variant="secondary" className="text-xs">
                                  {type}
                                </Badge>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {groups.map((group) => (
                <Card
                  key={group.id}
                  className="p-6 hover-elevate transition-all cursor-pointer"
                  data-testid={`card-group-${group.id}`}
                >
                  <div className="flex flex-col items-center text-center">
                    <Avatar className="w-32 h-32 mb-4" style={{ borderColor: group.color, borderWidth: '3px' }}>
                      {group.imageUrl && (
                        <AvatarImage src={group.imageUrl} alt={group.name} />
                      )}
                      <AvatarFallback 
                        style={{ backgroundColor: `${group.color}20` }}
                        className="text-3xl"
                      >
                        {getInitials(group.name)}
                      </AvatarFallback>
                    </Avatar>

                    <h3 className="text-xl font-semibold mb-2" data-testid={`text-name-${group.id}`}>
                      {group.name}
                    </h3>

                    <div className="flex items-center gap-2 mb-3">
                      <div
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: group.color }}
                        data-testid={`color-indicator-${group.id}`}
                      />
                      <span className="text-sm text-muted-foreground" data-testid={`text-member-count-${group.id}`}>
                        {group.members?.length || 0} members
                      </span>
                    </div>

                    {group.type && group.type.length > 0 && (
                      <div className="flex flex-wrap gap-1 justify-center">
                        {group.type.map((type, idx) => (
                          <Badge key={idx} variant="secondary" className="text-xs">
                            {type}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <LayoutGrid className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">No groups yet</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              Get started by creating your first group to organize your contacts
            </p>
            <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-group-empty">
              <Plus className="h-4 w-4" />
              Add Group
            </Button>
          </div>
        )}
      </div>

      <AddGroupDialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen} />
    </div>
  );
}
