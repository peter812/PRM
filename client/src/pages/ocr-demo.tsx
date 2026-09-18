import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ScanText,
  Upload,
  AlertCircle,
  Loader2,
  ImageIcon,
  Copy,
  Check,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Bot,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface OcrLine {
  text: string;
  score: number;
  box: number[][]; // [[x, y], [x, y], [x, y], [x, y]]
}

interface OcrResult {
  text: string;
  lines: OcrLine[];
  width: number;
  height: number;
}

interface PrmFaceSettings {
  apiUrl: string;
  hasApiKey: boolean;
}

export default function OcrDemoPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const lineRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [minScore, setMinScore] = useState<number>(0.5);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  // AI Identification state
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string>("");
  const [copiedAi, setCopiedAi] = useState(false);

  // Verify whether PRM-Compute / PRM-Face connection is configured
  const { data: settings } = useQuery<PrmFaceSettings>({
    queryKey: ["/api/prm-face/settings"],
  });

  const isConfigured = !!(settings?.apiUrl && settings?.hasApiKey);

  // Query Ollama settings for default vision model and prompt
  const { data: ollamaSettings } = useQuery<{
    enabled?: boolean;
    apiUrl?: string;
    model?: string;
    prompt?: string;
  }>({
    queryKey: ["/api/ollama/settings"],
  });

  useEffect(() => {
    if (ollamaSettings?.prompt && !systemPrompt) {
      setSystemPrompt(ollamaSettings.prompt);
    } else if (!systemPrompt) {
      setSystemPrompt("Identify and describe all key elements, people, text context, and details visible in this image.");
    }
  }, [ollamaSettings]);

  const handleRunAi = async () => {
    if (!imageFile) return;
    setIsAiLoading(true);
    setAiError(null);
    setAiResult(null);

    try {
      const formData = new FormData();
      formData.append("image", imageFile);
      if (systemPrompt.trim()) {
        formData.append("prompt", systemPrompt.trim());
        formData.append("system", systemPrompt.trim());
      }
      if (ollamaSettings?.model) {
        formData.append("model", ollamaSettings.model);
      }

      const res = await fetch("/api/ollama/describe", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Server error ${res.status}`);
      }

      setAiResult(data.description || "No description returned.");
      toast({
        title: "AI Analysis Complete",
        description: "Image identification results returned successfully.",
      });
    } catch (err: any) {
      setAiError(err.message);
      toast({
        title: "AI Identification Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleCopyAiResult = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedAi(true);
    setTimeout(() => setCopiedAi(false), 2000);
  };

  const processImage = async (file: File, scoreThreshold: number) => {
    setIsProcessing(true);
    setOcrResult(null);
    setHoveredIndex(null);

    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("min_score", String(scoreThreshold));

      const res = await fetch("/api/prm-face/ocr", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `Server error ${res.status}`);
      }

      const data: OcrResult = await res.json();
      setOcrResult(data);

      if (!data.lines || data.lines.length === 0) {
        toast({
          title: "No text detected",
          description: "No text lines met the confidence threshold in this image.",
        });
      } else {
        toast({
          title: "OCR Complete",
          description: `Identified ${data.lines.length} text line${data.lines.length === 1 ? "" : "s"}.`,
        });
      }
    } catch (err: any) {
      toast({
        title: "OCR Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) {
        toast({
          title: "Invalid file",
          description: "Please select an image file (PNG, JPEG, WebP, etc.).",
          variant: "destructive",
        });
        return;
      }

      setImageFile(file);
      setOcrResult(null);
      setNaturalSize(null);
      setHoveredIndex(null);
      setAiResult(null);
      setAiError(null);
      setIsAiLoading(false);

      const reader = new FileReader();
      reader.onload = (e) => {
        setImageDataUrl(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    },
    [toast]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleImageLoad = () => {
    if (!imgRef.current) return;
    setNaturalSize({
      w: imgRef.current.naturalWidth,
      h: imgRef.current.naturalHeight,
    });
  };

  const handleRunOcr = () => {
    if (!imageFile) return;
    processImage(imageFile, minScore);
  };

  const handleCopyText = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleCopyAll = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const scrollToLine = (index: number) => {
    setHoveredIndex(index);
    const element = lineRefs.current[index];
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };

  // Convert polygon or quad points to percentage bounding box
  const computePctBox = (box: number[][], natW: number, natH: number) => {
    const xs = box.map((p) => p[0]);
    const ys = box.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
      left: `${(minX / natW) * 100}%`,
      top: `${(minY / natH) * 100}%`,
      width: `${((maxX - minX) / natW) * 100}%`,
      height: `${((maxY - minY) / natH) * 100}%`,
    };
  };

  return (
    <div className="h-full overflow-auto">
      <div className="container max-w-4xl py-6 px-4 md:px-8 space-y-6">
        {/* Title Header */}
        <div className="space-y-1">
          <h1
            className="text-2xl font-bold flex items-center gap-2"
            data-testid="text-ocr-demo-title"
          >
            <ScanText className="h-6 w-6 text-primary" />
            OCR Demo
          </h1>
          <p className="text-muted-foreground text-sm">
            Extract and locate text from images using PRM-Compute's dedicated OCR engine.
            Detected lines are numbered and highlighted directly on the image.
          </p>
        </div>

        {/* Configuration Notice */}
        {!isConfigured && (
          <div
            className="flex items-start gap-3 rounded-md bg-muted p-4 text-sm"
            data-testid="alert-not-configured"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
            <span className="text-muted-foreground">
              PRM-Compute is not configured yet. Go to{" "}
              <Link href="/settings/recognition" className="underline font-medium text-foreground">
                Settings → Recognition
              </Link>{" "}
              to configure your PRM-Compute API URL and key.
            </span>
          </div>
        )}

        {/* Upload Dropzone */}
        <Card data-testid="card-upload">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              Upload Image
            </CardTitle>
            <CardDescription>
              Drag and drop an image containing text or click to browse.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-primary/50 transition-colors min-h-36"
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              data-testid="dropzone-ocr"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleInputChange}
                data-testid="input-image-file"
              />
              <div className="rounded-full bg-muted p-3">
                <Upload className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">
                  {imageFile ? imageFile.name : "Drop an image here"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {imageFile ? "Click or drop another image to replace" : "or click to browse"}
                </p>
              </div>
            </div>

            {/* Controls Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-2">
              <div className="flex items-center gap-3 flex-1 max-w-xs">
                <SlidersHorizontal className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Min Confidence</span>
                    <span className="font-mono font-medium text-foreground">
                      {Math.round(minScore * 100)}%
                    </span>
                  </div>
                  <Slider
                    value={[minScore * 100]}
                    min={10}
                    max={95}
                    step={5}
                    onValueChange={(vals) => setMinScore(vals[0] / 100)}
                    disabled={isProcessing}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                {imageDataUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setImageFile(null);
                      setImageDataUrl(null);
                      setOcrResult(null);
                      setNaturalSize(null);
                      setAiResult(null);
                      setAiError(null);
                      setIsAiLoading(false);
                    }}
                    disabled={isProcessing}
                  >
                    <RotateCcw className="h-4 w-4 mr-1" />
                    Reset
                  </Button>
                )}
                <Button
                  onClick={handleRunOcr}
                  disabled={!imageFile || isProcessing || !isConfigured}
                  className="gap-2"
                  data-testid="button-run-ocr"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Extracting Text…
                    </>
                  ) : (
                    <>
                      <ScanText className="h-4 w-4" />
                      Run OCR
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Image Preview with Bounding Boxes */}
        {imageDataUrl && (
          <Card data-testid="card-image-preview">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <ScanText className="h-4 w-4" />
                  Image & Detected Bounds
                </CardTitle>
                <CardDescription>
                  {ocrResult
                    ? `${ocrResult.lines.length} bounded text line${
                        ocrResult.lines.length === 1 ? "" : "s"
                      } located. Hover or click a number to highlight.`
                    : "Ready to run OCR on this image."}
                </CardDescription>
              </div>
              {ocrResult && (
                <Badge variant="secondary" className="font-mono">
                  {ocrResult.lines.length} lines
                </Badge>
              )}
            </CardHeader>
            <CardContent>
              <div className="flex justify-center bg-muted/40 rounded-lg p-2 overflow-hidden border">
                <div
                  className="relative inline-block max-w-full"
                  data-testid="container-ocr-image"
                >
                  <img
                    ref={imgRef}
                    src={imageDataUrl}
                    alt="Uploaded preview"
                    className="max-w-full max-h-[500px] object-contain rounded block"
                    onLoad={handleImageLoad}
                    data-testid="img-ocr-preview"
                  />

                  {/* Render numbered bounding boxes */}
                  {naturalSize &&
                    ocrResult?.lines.map((line, idx) => {
                      const pos = computePctBox(line.box, naturalSize.w, naturalSize.h);
                      const isHovered = hoveredIndex === idx;

                      return (
                        <div
                          key={idx}
                          onClick={() => scrollToLine(idx)}
                          onMouseEnter={() => setHoveredIndex(idx)}
                          onMouseLeave={() => setHoveredIndex(null)}
                          style={{
                            position: "absolute",
                            left: pos.left,
                            top: pos.top,
                            width: pos.width,
                            height: pos.height,
                            borderWidth: isHovered ? "2.5px" : "1.5px",
                            borderStyle: "solid",
                            borderColor: isHovered ? "#2563eb" : "#3b82f6",
                            backgroundColor: isHovered
                              ? "rgba(37, 99, 235, 0.22)"
                              : "rgba(59, 130, 246, 0.08)",
                            boxSizing: "border-box",
                            cursor: "pointer",
                            transition: "all 0.15s ease-in-out",
                            zIndex: isHovered ? 20 : 10,
                          }}
                          className="rounded-sm"
                          data-testid={`ocr-box-${idx}`}
                          title={`#${idx + 1}: ${line.text} (${Math.round(line.score * 100)}%)`}
                        >
                          {/* Number Badge in Box Corner */}
                          <span
                            style={{
                              position: "absolute",
                              top: "-18px",
                              left: "-1px",
                              fontSize: "10px",
                              fontWeight: 700,
                              lineHeight: "14px",
                              padding: "0 4px",
                              borderRadius: "3px",
                              backgroundColor: isHovered ? "#1d4ed8" : "#2563eb",
                              color: "#ffffff",
                              whiteSpace: "nowrap",
                              pointerEvents: "none",
                              boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
                            }}
                          >
                            {idx + 1}
                          </span>
                        </div>
                      );
                    })}

                  {/* Processing Overlay */}
                  {isProcessing && (
                    <div
                      className="absolute inset-0 flex flex-col items-center justify-center bg-background/70 backdrop-blur-xs rounded"
                      data-testid="overlay-processing"
                    >
                      <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
                      <p className="text-sm font-medium">Extracting text with PP-OCR…</p>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Numbered Sections with Identified Text Below */}
        {ocrResult && (
          <Card data-testid="card-ocr-results">
            <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <ScanText className="h-4 w-4" />
                  Identified Text Sections
                </CardTitle>
                <CardDescription>
                  Review detected text lines ordered from top to bottom.
                </CardDescription>
              </div>

              {ocrResult.text && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopyAll(ocrResult.text)}
                  className="gap-1.5 self-start sm:self-auto"
                  data-testid="button-copy-all"
                >
                  {copiedAll ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-green-600" />
                      Copied All
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy All Text
                    </>
                  )}
                </Button>
              )}
            </CardHeader>

            <CardContent>
              <Tabs defaultValue="sections" className="w-full">
                <TabsList className="mb-4">
                  <TabsTrigger value="sections">Numbered Sections ({ocrResult.lines.length})</TabsTrigger>
                  <TabsTrigger value="full-text">Full Text</TabsTrigger>
                </TabsList>

                {/* Tab 1: Numbered Sections */}
                <TabsContent value="sections">
                  {ocrResult.lines.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      No text lines found matching the confidence threshold.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                      {ocrResult.lines.map((line, idx) => {
                        const isHovered = hoveredIndex === idx;
                        const isCopied = copiedIndex === idx;
                        const confidencePct = Math.round(line.score * 100);

                        return (
                          <div
                            key={idx}
                            ref={(el) => (lineRefs.current[idx] = el)}
                            onMouseEnter={() => setHoveredIndex(idx)}
                            onMouseLeave={() => setHoveredIndex(null)}
                            className={`p-3 rounded-lg border transition-all flex items-start justify-between gap-3 ${
                              isHovered
                                ? "border-primary bg-primary/5 shadow-xs"
                                : "bg-card hover:bg-muted/40"
                            }`}
                            data-testid={`ocr-line-item-${idx}`}
                          >
                            <div className="flex items-start gap-3 min-w-0 flex-1">
                              {/* Number Badge */}
                              <Badge
                                variant={isHovered ? "default" : "outline"}
                                className={`shrink-0 text-xs px-2 py-0.5 font-bold cursor-pointer ${
                                  isHovered ? "bg-primary text-primary-foreground" : ""
                                }`}
                              >
                                #{idx + 1}
                              </Badge>

                              {/* Text & Meta */}
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium leading-snug break-words">
                                  {line.text}
                                </p>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-xs text-muted-foreground">
                                    Confidence:{" "}
                                    <span
                                      className={`font-mono font-medium ${
                                        confidencePct >= 80
                                          ? "text-green-600 dark:text-green-400"
                                          : confidencePct >= 60
                                          ? "text-yellow-600 dark:text-yellow-400"
                                          : "text-muted-foreground"
                                      }`}
                                    >
                                      {confidencePct}%
                                    </span>
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Action: Copy line */}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                              onClick={() => handleCopyText(line.text, idx)}
                              title="Copy text"
                              data-testid={`button-copy-line-${idx}`}
                            >
                              {isCopied ? (
                                <Check className="h-4 w-4 text-green-600" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </TabsContent>

                {/* Tab 2: Consolidated Full Text */}
                <TabsContent value="full-text">
                  <div className="space-y-2">
                    <Textarea
                      value={ocrResult.text}
                      readOnly
                      className="min-h-48 font-mono text-sm resize-y"
                      placeholder="No extracted text"
                      data-testid="textarea-full-text"
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}

        {/* Run AI Identification Section (Visible once OCR has been run) */}
        {ocrResult && (
          <Card data-testid="card-ai-identification">
            <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  AI Image Identification
                </CardTitle>
                <CardDescription>
                  Run this image through the vision model using your system prompt to identify and describe what is in the image.
                </CardDescription>
              </div>
              {ollamaSettings?.model && (
                <Badge variant="outline" className="font-mono text-xs self-start sm:self-auto">
                  {ollamaSettings.model}
                </Badge>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label
                  htmlFor="ocr-ai-system-prompt"
                  className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"
                >
                  <Bot className="h-3.5 w-3.5" />
                  System / Vision Prompt
                </Label>
                <Textarea
                  id="ocr-ai-system-prompt"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Enter instructions for the image identification model..."
                  className="min-h-20 text-sm resize-y"
                  disabled={isAiLoading}
                  data-testid="textarea-system-prompt"
                />
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-1">
                <p className="text-xs text-muted-foreground">
                  {ollamaSettings?.apiUrl ? (
                    <span>
                      Connected to Ollama at{" "}
                      <code className="text-foreground">{ollamaSettings.apiUrl}</code>
                    </span>
                  ) : (
                    <span>
                      Configure Ollama under{" "}
                      <Link href="/settings/intelligence/images" className="underline">
                        Settings → Intelligence
                      </Link>
                    </span>
                  )}
                </p>

                <Button
                  onClick={handleRunAi}
                  disabled={isAiLoading || !imageFile}
                  className="gap-2 self-end sm:self-auto"
                  data-testid="button-run-ai"
                >
                  {isAiLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Running AI…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Run AI
                    </>
                  )}
                </Button>
              </div>

              {aiError && (
                <div
                  className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-start gap-2"
                  data-testid="alert-ai-error"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">AI Identification Failed</p>
                    <p className="text-xs mt-0.5">{aiError}</p>
                  </div>
                </div>
              )}

              {/* AI Identification Results */}
              {aiResult && (
                <div className="mt-4 pt-4 border-t space-y-3" data-testid="section-ai-results">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Bot className="h-4 w-4 text-primary" />
                      AI Identification Results
                    </h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopyAiResult(aiResult)}
                      className="gap-1.5 h-8 text-xs"
                      data-testid="button-copy-ai-result"
                    >
                      {copiedAi ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-green-600" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Copy Result
                        </>
                      )}
                    </Button>
                  </div>

                  <div
                    className="rounded-lg bg-muted/50 p-4 border text-sm leading-relaxed whitespace-pre-wrap font-sans"
                    data-testid="text-ai-result"
                  >
                    {aiResult}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
