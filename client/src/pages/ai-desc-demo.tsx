import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, Sparkles, ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function AiDescDemoPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [description, setDescription] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setDescription("");
    const url = URL.createObjectURL(file);
    setImagePreviewUrl(url);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    setImageFile(file);
    setDescription("");
    const url = URL.createObjectURL(file);
    setImagePreviewUrl(url);
  };

  const handleDescribe = async () => {
    if (!imageFile) return;
    setIsLoading(true);
    setDescription("");
    try {
      const formData = new FormData();
      formData.append("image", imageFile);
      const res = await fetch("/api/ollama/describe", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to get description");
      }
      setDescription(data.description ?? "");
    } catch (err: any) {
      toast({ title: "Description failed", description: err.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container max-w-2xl mx-auto py-6 px-4 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-ai-desc-demo-title">
          <Sparkles className="h-6 w-6" />
          AI desc demo
        </h1>
        <p className="text-muted-foreground text-sm">
          Upload an image and the AI will describe what it sees.
        </p>
      </div>

      <div
        className="border-2 border-dashed rounded-md p-6 flex flex-col items-center justify-center gap-3 cursor-pointer hover-elevate transition-colors min-h-40"
        onClick={() => fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        data-testid="dropzone-image-upload"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
          data-testid="input-image-file"
        />
        {imagePreviewUrl ? (
          <div className="flex flex-col items-center gap-2 w-full">
            <img
              src={imagePreviewUrl}
              alt="Uploaded preview"
              className="max-h-64 rounded-md object-contain"
              data-testid="img-preview"
            />
            <p className="text-xs text-muted-foreground">{imageFile?.name}</p>
            <p className="text-xs text-muted-foreground">Click or drop to replace</p>
          </div>
        ) : (
          <>
            <div className="rounded-full bg-muted p-3">
              <ImageIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">Drop an image here</p>
              <p className="text-xs text-muted-foreground mt-0.5">or click to browse</p>
            </div>
          </>
        )}
      </div>

      <Button
        onClick={handleDescribe}
        disabled={!imageFile || isLoading}
        className="w-full"
        data-testid="button-describe-image"
      >
        {isLoading ? (
          <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Describing…</>
        ) : (
          <><Sparkles className="h-4 w-4 mr-2" />Describe Image</>
        )}
      </Button>

      {(description || isLoading) && (
        <div className="space-y-2" data-testid="section-description-result">
          <Label htmlFor="description-output">Description</Label>
          <Textarea
            id="description-output"
            value={isLoading ? "" : description}
            readOnly
            placeholder={isLoading ? "Generating description…" : ""}
            className="min-h-32 resize-y"
            data-testid="textarea-description-output"
          />
        </div>
      )}
    </div>
  );
}
