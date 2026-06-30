import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, UserPlus, HelpCircle, Check, Eye, AlertCircle } from "lucide-react";

type ImageQuestion = {
  id: string;
  photoId: string;
  faceUuid: string;
  subImageUrl: string;
  coordinates: { x: number; y: number; w: number; h: number };
  status: string;
  photoLocation: string;
};

type Person = {
  id: string;
  firstName: string;
  lastName: string;
};

export default function UnknownFacesPage() {
  const { toast } = useToast();
  const [selectedPersonMap, setSelectedPersonMap] = useState<Record<string, string>>({});
  const [searchFilterMap, setSearchFilterMap] = useState<Record<string, string>>({});
  const [newPersonName, setNewPersonName] = useState("");
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

  // Fetch pending face questions
  const { data: questions = [], isLoading: isLoadingQuestions } = useQuery<ImageQuestion[]>({
    queryKey: ["/api/image-questions/pending"],
  });

  // Fetch all CRM people
  const { data: people = [], isLoading: isLoadingPeople } = useQuery<Person[]>({
    queryKey: ["/api/people"],
  });

  // Resolve question mutation
  const resolveMutation = useMutation({
    mutationFn: async (vars: { questionId: string; resolution: string; personId?: string; name?: string }) => {
      const res = await apiRequest("POST", "/api/image-questions/resolve", vars);
      return res.json() as Promise<{ success: boolean; descriptionGenerated?: boolean; description?: string }>;
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-questions/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      
      // Clean local select state for this question
      setSelectedPersonMap(prev => {
        const next = { ...prev };
        delete next[vars.questionId];
        return next;
      });

      let descriptionMsg = "";
      if (data.descriptionGenerated) {
        descriptionMsg = " Ollama has generated a new description for this photo.";
      }

      toast({
        title: "Face Resolved",
        description: `Successfully linked face in image.${descriptionMsg}`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to resolve face",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleResolveKnown = (questionId: string) => {
    const personId = selectedPersonMap[questionId];
    if (!personId) {
      toast({ title: "No contact selected", description: "Please select an existing contact first.", variant: "destructive" });
      return;
    }
    resolveMutation.mutate({
      questionId,
      resolution: "known_person",
      personId,
    });
  };

  const handleCreateNewPerson = () => {
    if (!activeQuestionId || !newPersonName.trim()) return;
    resolveMutation.mutate({
      questionId: activeQuestionId,
      resolution: "create_person",
      name: newPersonName.trim(),
    });
    setNewPersonName("");
    setActiveQuestionId(null);
  };

  const handleResolveUnknown = (questionId: string) => {
    resolveMutation.mutate({
      questionId,
      resolution: "unknown",
    });
  };

  if (isLoadingQuestions || isLoadingPeople) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="container max-w-full md:max-w-6xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
        <div className="space-y-2 mb-6">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <HelpCircle className="h-6 w-6" />
            Unknown Faces Queue
          </h1>
          <p className="text-muted-foreground">
            Identify unrecognized faces extracted by background scraper jobs. Assign them to existing CRM contacts,
            create new contacts, or mark them as permanently unknown.
          </p>
        </div>

        {questions.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center border-2 border-dashed rounded-md bg-muted/20">
            <Check className="h-10 w-10 text-green-500 mb-4" />
            <h3 className="text-lg font-medium">All Faces Identified</h3>
            <p className="text-sm text-muted-foreground mt-1">
              There are no pending unrecognized faces in the queue.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {questions.map((question) => {
              const filterText = searchFilterMap[question.id] || "";
              const filteredPeople = people.filter(p =>
                `${p.firstName} ${p.lastName}`.toLowerCase().includes(filterText.toLowerCase())
              );

              return (
                <Card key={question.id} className="overflow-hidden flex flex-col justify-between" data-testid={`card-question-${question.id}`}>
                  <CardHeader className="p-4 bg-muted/30 border-b flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-sm font-semibold">Pending Assignment</CardTitle>
                      <CardDescription className="text-xs">Detected Face cutout</CardDescription>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setPreviewPhoto(question.photoLocation)}
                      title="View Full Scene Photo"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </CardHeader>
                  <CardContent className="p-4 flex-1 flex flex-col justify-between space-y-4">
                    {/* Face crop display */}
                    <div className="flex justify-center bg-zinc-900 rounded-md p-4 h-40 items-center overflow-hidden relative group">
                      <img
                        src={question.subImageUrl}
                        alt="Crop"
                        className="max-h-full object-contain rounded border border-muted"
                      />
                    </div>

                    <div className="space-y-3">
                      {/* Search and select existing contact */}
                      <div className="space-y-1">
                        <Label htmlFor={`select-person-${question.id}`} className="text-xs">Link to Contact</Label>
                        <Input
                          placeholder="Search contacts..."
                          value={filterText}
                          onChange={(e) => setSearchFilterMap(prev => ({ ...prev, [question.id]: e.target.value }))}
                          className="h-8 text-xs mb-1.5"
                        />
                        <Select
                          value={selectedPersonMap[question.id] || ""}
                          onValueChange={(val) => setSelectedPersonMap(prev => ({ ...prev, [question.id]: val }))}
                        >
                          <SelectTrigger id={`select-person-${question.id}`} className="h-9 text-xs">
                            <SelectValue placeholder="Select contact..." />
                          </SelectTrigger>
                          <SelectContent>
                            {filteredPeople.slice(0, 50).map((p) => (
                              <SelectItem key={p.id} value={p.id} className="text-xs">
                                {p.firstName} {p.lastName}
                              </SelectItem>
                            ))}
                            {filteredPeople.length === 0 && (
                              <div className="p-2 text-center text-xs text-muted-foreground">No contacts found</div>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        className="flex-1 text-xs"
                        onClick={() => handleResolveKnown(question.id)}
                        disabled={resolveMutation.isPending}
                      >
                        Assign Contact
                      </Button>
                      
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs flex gap-1 items-center"
                            onClick={() => {
                              setActiveQuestionId(question.id);
                              setNewPersonName("");
                            }}
                          >
                            <UserPlus className="h-3 w-3" />
                            New Contact
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Create New CRM Contact</DialogTitle>
                            <DialogDescription>
                              Enter a name for the new person to add them to your CRM contacts and link this face cutout.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 py-2">
                            <div className="space-y-2">
                              <Label htmlFor="new-person-name">Full Name</Label>
                              <Input
                                id="new-person-name"
                                placeholder="Alice Smith"
                                value={newPersonName}
                                onChange={(e) => setNewPersonName(e.target.value)}
                              />
                            </div>
                          </div>
                          <DialogFooter>
                            <Button
                              onClick={handleCreateNewPerson}
                              disabled={resolveMutation.isPending || !newPersonName.trim()}
                            >
                              Create & Link
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-destructive hover:bg-destructive/10"
                        onClick={() => handleResolveUnknown(question.id)}
                        disabled={resolveMutation.isPending}
                      >
                        Unknown
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Preview Dialog for full parent photo */}
      <Dialog open={!!previewPhoto} onOpenChange={(open) => !open && setPreviewPhoto(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Full Scene Photo</DialogTitle>
            <DialogDescription>Original scene where face cutout was detected.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center bg-zinc-900 rounded p-2 overflow-hidden h-96">
            <img
              src={previewPhoto ?? ""}
              alt="Scene preview"
              className="max-h-full max-w-full object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
