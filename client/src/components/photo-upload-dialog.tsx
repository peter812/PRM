import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Upload, Scan, UserPlus, Check, Sparkles, BrainCircuit, X } from "lucide-react";

type FaceBox = { x: number; y: number; w: number; h: number };
type FaceResult = {
  face_uuid: string;
  face_index: number;
  box: FaceBox;
  person_uuid?: string | null;
  matched?: boolean;
};

type Person = {
  id: string;
  firstName: string;
  lastName: string;
};

const COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#6366f1", "#ec4899", "#14b8a6",
];

interface PhotoUploadDialogProps {
  open: boolean;
  onClose: () => void;
}

export function PhotoUploadDialog({ open, onClose }: PhotoUploadDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Flow states
  const [step, setStep] = useState<"upload" | "identify" | "saving" | "description">("upload");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [faces, setFaces] = useState<FaceResult[]>([]);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  // Identification states
  const [assignments, setAssignments] = useState<Record<number, {
    faceUuid: string;
    coordinates: FaceBox;
    resolution: "known_person" | "create_person" | "unknown";
    personId?: string;
    name?: string;
  }>>({});
  const [filterTextMap, setFilterTextMap] = useState<Record<number, string>>({});
  const [newPersonNameMap, setNewPersonNameMap] = useState<Record<number, string>>({});
  
  // Ollama states
  const [waitOllama, setWaitOllama] = useState(true);
  const [ollamaDescription, setOllamaDescription] = useState("");

  // Fetch CRM contacts
  const { data: people = [] } = useQuery<Person[]>({
    queryKey: ["/api/people"],
    enabled: open,
  });

  // Reset dialog state on open/close
  useEffect(() => {
    if (open) {
      setStep("upload");
      setImageFile(null);
      setImageDataUrl(null);
      setPhotoId(null);
      setImageUrl(null);
      setFaces([]);
      setNaturalSize(null);
      setAssignments({});
      setFilterTextMap({});
      setNewPersonNameMap({});
      setOllamaDescription("");
    }
  }, [open]);

  // Image load measurement for overlaying bounding boxes
  const handleImageLoad = () => {
    if (!imgRef.current) return;
    setNaturalSize({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
  };

  const pctBox = (box: FaceBox, nat: { w: number; h: number }) => ({
    left: `${(box.x / nat.w) * 100}%`,
    top: `${(box.y / nat.h) * 100}%`,
    width: `${(box.w / nat.w) * 100}%`,
    height: `${(box.h / nat.h) * 100}%`,
  });

  // Interactive image upload to server + PRM-face temp detection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please upload an image file.", variant: "destructive" });
      return;
    }

    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      setImageDataUrl(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Upload and detect faces
    uploadMutation.mutate(file);
  };

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("prmLocation", "manual-interactive-upload");

      const res = await fetch("/api/prm-face/img/add-interactive", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown server error" }));
        throw new Error(body.error || `Server returned ${res.status}`);
      }

      return res.json() as Promise<{
        imageUrl: string;
        photoId: string;
        faceDetection: { faces_detected: number; results: FaceResult[] };
      }>;
    },
    onSuccess: (data) => {
      setPhotoId(data.photoId);
      setImageUrl(data.imageUrl);
      const results = data.faceDetection.results || [];
      setFaces(results);
      
      // Pre-populate assignments using matched identities if returned
      const initialAssignments: typeof assignments = {};
      results.forEach((face) => {
        initialAssignments[face.face_index] = {
          faceUuid: face.face_uuid,
          coordinates: face.box,
          resolution: face.person_uuid ? "known_person" : "unknown",
          personId: face.person_uuid || undefined,
        };
      });
      setAssignments(initialAssignments);

      setStep("identify");
      toast({
        title: "Image Uploaded",
        description: `Detection complete. Found ${results.length} face(s).`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Upload and detection failed",
        description: err.message,
        variant: "destructive",
      });
      setStep("upload");
      setImageFile(null);
      setImageDataUrl(null);
    },
  });

  // Save assignments & run optional Ollama description
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!photoId) throw new Error("No photo identifier found");
      const list = Object.values(assignments).map(a => ({
        faceUuid: a.faceUuid,
        coordinates: a.coordinates,
        resolution: a.resolution,
        personId: a.personId,
        name: a.name,
      }));

      const res = await apiRequest("POST", "/api/prm-face/photo/save-assignments", {
        photoId,
        assignments: list,
        waitOllama,
      });

      return res.json() as Promise<{ success: boolean; description?: string }>;
    },
    onMutate: () => {
      setStep("saving");
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-questions/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });

      if (waitOllama && data.description) {
        setOllamaDescription(data.description);
        setStep("description");
      } else {
        toast({ title: "Photo saved", description: "Image saved and faces mapped successfully." });
        onClose();
      }
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save assignments", description: err.message, variant: "destructive" });
      setStep("identify");
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && step !== "saving") onClose(); }}>
      <DialogContent className="max-w-4xl w-full max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-6 pb-4 border-b shrink-0 flex flex-row items-center justify-between">
          <div>
            <DialogTitle className="text-xl font-semibold flex items-center gap-2">
              <Scan className="h-5 w-5" />
              Upload &amp; Identify Scene Photo
            </DialogTitle>
            <DialogDescription>
              Upload a scene photo to automatically detect and index faces in your CRM.
            </DialogDescription>
          </div>
          {step !== "saving" && (
            <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
              <X className="h-4 w-4" />
            </Button>
          )}
        </DialogHeader>

        {/* 1. Uploading State */}
        {step === "upload" && (
          <div className="flex-1 flex flex-col items-center justify-center p-12 space-y-6">
            {uploadMutation.isPending ? (
              <div className="flex flex-col items-center gap-4 text-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <div>
                  <h3 className="font-semibold text-lg">Processing Photo...</h3>
                  <p className="text-sm text-muted-foreground">Uploading image and scanning for faces</p>
                </div>
              </div>
            ) : (
              <div
                className="border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 transition rounded-lg p-16 flex flex-col items-center gap-4 w-full max-w-lg cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) processFile(file);
                }}
              >
                <div className="p-4 rounded-full bg-primary/10 text-primary">
                  <Upload className="h-8 w-8" />
                </div>
                <div className="text-center">
                  <p className="font-medium text-sm">Drag &amp; drop your image here, or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">Supports PNG, JPG, JPEG, WebP</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>
            )}
          </div>
        )}

        {/* 2. Identify State */}
        {step === "identify" && imageDataUrl && (
          <div className="flex-1 overflow-y-auto p-6 flex flex-col md:flex-row gap-6">
            {/* Left Column: Image with bounding box overlays */}
            <div className="flex-1 relative inline-block max-w-full bg-zinc-950 rounded-lg overflow-hidden border self-start">
              <img
                ref={imgRef}
                src={imageDataUrl}
                alt="Uploaded Scene"
                className="max-w-full w-full block object-contain max-h-[50vh] md:max-h-[60vh]"
                onLoad={handleImageLoad}
              />
              {naturalSize && faces.map((face, i) => {
                const pos = pctBox(face.box, naturalSize);
                const color = COLORS[i % COLORS.length];
                return (
                  <div
                    key={face.face_uuid}
                    style={{
                      position: "absolute",
                      left: pos.left,
                      top: pos.top,
                      width: pos.width,
                      height: pos.height,
                      border: `2.5px solid ${color}`,
                      borderRadius: 3,
                      boxSizing: "border-box",
                      pointerEvents: "none",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        top: 2,
                        right: 2,
                        background: color,
                        color: "#fff",
                        fontSize: 10,
                        fontWeight: 700,
                        lineHeight: 1,
                        padding: "2px 4px",
                        borderRadius: 2,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {i + 1}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Right Column: Face lists & mapping controls */}
            <div className="w-full md:w-80 shrink-0 space-y-4">
              <h3 className="font-semibold text-sm flex items-center gap-1.5 border-b pb-2">
                <BrainCircuit className="h-4 w-4" />
                Detected Faces ({faces.length})
              </h3>
              
              {faces.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No faces detected. You can save the photo without mapping.
                </div>
              ) : (
                <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
                  {faces.map((face, i) => {
                    const color = COLORS[i % COLORS.length];
                    const ass = assignments[face.face_index] || { resolution: "unknown" };
                    const filterText = filterTextMap[face.face_index] || "";
                    const newPersonName = newPersonNameMap[face.face_index] || "";

                    const filteredPeople = people.filter(p =>
                      `${p.firstName} ${p.lastName}`.toLowerCase().includes(filterText.toLowerCase())
                    );

                    return (
                      <Card key={face.face_uuid} className="border-l-4" style={{ borderLeftColor: color }}>
                        <CardContent className="p-3 space-y-3">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-5 w-5 rounded flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                              style={{ background: color }}
                            >
                              {i + 1}
                            </span>
                            <span className="text-xs font-semibold">Face {i + 1}</span>

                            <div className="ml-auto flex gap-1.5">
                              <Button
                                size="sm"
                                variant={ass.resolution === "unknown" ? "secondary" : "outline"}
                                className="text-[10px] h-6 px-1.5"
                                onClick={() => setAssignments(prev => ({
                                  ...prev,
                                  [face.face_index]: {
                                    ...prev[face.face_index],
                                    resolution: "unknown",
                                    personId: undefined,
                                    name: undefined
                                  }
                                }))}
                              >
                                Unknown
                              </Button>
                              
                              <Button
                                size="sm"
                                variant={ass.resolution === "create_person" ? "secondary" : "outline"}
                                className="text-[10px] h-6 px-1.5 flex gap-0.5 items-center"
                                onClick={() => setAssignments(prev => ({
                                  ...prev,
                                  [face.face_index]: {
                                    ...prev[face.face_index],
                                    resolution: "create_person",
                                    personId: undefined,
                                    name: newPersonName || ""
                                  }
                                }))}
                              >
                                <UserPlus className="h-2.5 w-2.5" />
                                New
                              </Button>
                            </div>
                          </div>

                          {ass.resolution === "known_person" && (
                            <div className="space-y-1.5">
                              <Label className="text-[10px]">CRM Contact Link</Label>
                              <Input
                                placeholder="Search contacts..."
                                value={filterText}
                                onChange={(e) => setFilterTextMap(prev => ({ ...prev, [face.face_index]: e.target.value }))}
                                className="h-7 text-xs"
                              />
                              <Select
                                value={ass.personId || ""}
                                onValueChange={(val) => setAssignments(prev => ({
                                  ...prev,
                                  [face.face_index]: {
                                    ...prev[face.face_index],
                                    resolution: "known_person",
                                    personId: val,
                                    name: undefined
                                  }
                                }))}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="Select contact..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {filteredPeople.slice(0, 30).map((p) => (
                                    <SelectItem key={p.id} value={p.id} className="text-xs">
                                      {p.firstName} {p.lastName}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}

                          {ass.resolution === "create_person" && (
                            <div className="space-y-1">
                              <Label className="text-[10px]">Contact Full Name</Label>
                              <Input
                                placeholder="Enter full name"
                                value={newPersonName}
                                onChange={(e) => {
                                  setNewPersonNameMap(prev => ({ ...prev, [face.face_index]: e.target.value }));
                                  setAssignments(prev => ({
                                    ...prev,
                                    [face.face_index]: {
                                      ...prev[face.face_index],
                                      name: e.target.value
                                    }
                                  }));
                                }}
                                className="h-8 text-xs"
                              />
                            </div>
                          )}

                          {ass.resolution === "unknown" && (
                            <div className="text-[10px] text-muted-foreground text-center py-1">
                              Will be saved as unrecognized face.
                            </div>
                          )}

                          {ass.resolution !== "known_person" && (
                            <Button
                              variant="ghost"
                              className="h-auto p-0 text-[10px] text-primary underline hover:underline justify-start"
                              onClick={() => setAssignments(prev => ({
                                ...prev,
                                [face.face_index]: {
                                  ...prev[face.face_index],
                                  resolution: "known_person",
                                }
                              }))}
                            >
                              Search existing contact...
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-between border-t pt-3 mt-4">
                <div className="space-y-0.5">
                  <Label htmlFor="ollama-toggle" className="text-xs font-semibold">Ollama Scene Description</Label>
                  <p className="text-[10px] text-muted-foreground">Describe photo using Ollama vision</p>
                </div>
                <Switch
                  id="ollama-toggle"
                  checked={waitOllama}
                  onCheckedChange={setWaitOllama}
                />
              </div>
            </div>
          </div>
        )}

        {/* 3. Saving & Scene Analysis State */}
        {step === "saving" && (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <div>
              <h3 className="font-semibold text-lg">Saving &amp; Analyzing Photo...</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {waitOllama
                  ? "Ollama LLM is currently describing the scene. Please hold..."
                  : "Updating databases and registers..."}
              </p>
            </div>
          </div>
        )}

        {/* 4. Description Display State */}
        {step === "description" && (
          <div className="flex-1 p-6 flex flex-col space-y-4 overflow-y-auto">
            <div className="flex items-center gap-2 border-b pb-3">
              <Sparkles className="h-5 w-5 text-amber-500" />
              <h3 className="font-semibold text-lg">Ollama Vision Analysis Result</h3>
            </div>
            
            <div className="bg-muted p-4 rounded-md font-mono text-sm leading-relaxed whitespace-pre-wrap flex-1 min-h-[200px]">
              {ollamaDescription || "No description could be generated."}
            </div>
          </div>
        )}

        {/* Footer */}
        <DialogFooter className="p-4 border-t shrink-0 flex-row gap-2 justify-end">
          {step === "identify" && (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                <Check className="h-4 w-4 mr-1.5" />
                Save Assignments
              </Button>
            </>
          )}

          {step === "description" && (
            <Button onClick={onClose} className="px-6">
              Done &amp; Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
