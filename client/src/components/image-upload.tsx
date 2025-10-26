import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, X, Image as ImageIcon } from "lucide-react";
import { ImageCropModal } from "./image-crop-modal";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ImageUploadProps {
  currentImageUrl?: string | null;
  onImageChange: (imageUrl: string | null) => void;
  aspectRatio?: number;
  className?: string;
}

export function ImageUpload({
  currentImageUrl,
  onImageChange,
  aspectRatio = 1,
  className = "",
}: ImageUploadProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({
        title: "Invalid file type",
        description: "Please select an image file",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setSelectedImage(reader.result as string);
      setCropModalOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const handleCropComplete = async (croppedBlob: Blob) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", croppedBlob, "cropped-image.jpg");

      const response = await apiRequest<{ imageUrl: string }>("/api/upload-image", {
        method: "POST",
        body: formData,
      });

      onImageChange(response.imageUrl);
      toast({
        title: "Success",
        description: "Image uploaded successfully",
      });
    } catch (error) {
      console.error("Error uploading image:", error);
      toast({
        title: "Error",
        description: "Failed to upload image",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      setSelectedImage(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRemoveImage = async () => {
    if (currentImageUrl) {
      try {
        await apiRequest("/api/delete-image", {
          method: "DELETE",
          body: JSON.stringify({ imageUrl: currentImageUrl }),
          headers: {
            "Content-Type": "application/json",
          },
        });
      } catch (error) {
        console.error("Error deleting image from S3:", error);
      }
    }
    onImageChange(null);
  };

  return (
    <div className={className}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
        data-testid="input-image-file"
      />

      {currentImageUrl ? (
        <div className="relative inline-block">
          <img
            src={currentImageUrl}
            alt="Uploaded"
            className="h-32 w-32 rounded-md object-cover border"
            data-testid="img-uploaded"
          />
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
            onClick={handleRemoveImage}
            data-testid="button-remove-image"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="h-32 w-32 flex flex-col gap-2"
          data-testid="button-upload-image"
        >
          {uploading ? (
            <>
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              <span className="text-xs">Uploading...</span>
            </>
          ) : (
            <>
              <ImageIcon className="h-8 w-8" />
              <span className="text-xs">Upload Image</span>
            </>
          )}
        </Button>
      )}

      {selectedImage && (
        <ImageCropModal
          open={cropModalOpen}
          onClose={() => {
            setCropModalOpen(false);
            setSelectedImage(null);
            if (fileInputRef.current) {
              fileInputRef.current.value = "";
            }
          }}
          imageSrc={selectedImage}
          onCropComplete={handleCropComplete}
          aspectRatio={aspectRatio}
        />
      )}
    </div>
  );
}
