import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import {
  Scan,
  BrainCircuit,
  Database,
  Radar,
  ChevronRight,
  ImageIcon,
  Users,
  Share2,
  Camera,
  Settings,
  Loader2
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { imageDetailHref } from "@/lib/image-link";

type ServiceStatus = "loading" | "grey" | "green" | "yellow" | "red";

type PrmFaceSettings = {
  apiUrl: string;
  hasApiKey: boolean;
};

type OllamaSettings = {
  enabled: boolean;
  apiUrl: string;
  model: string;
  textModel: string;
};

type VectorSettings = {
  enabled: boolean;
  qdrantUrl: string;
  collectionName: string;
  embeddingModel: string;
};

type OsintSettings = {
  enabled: boolean;
  apiUrl: string;
  hasApiKey: boolean;
};

type TestResult = {
  ok: boolean;
  message: string;
};

type PhotoListItem = {
  id: string;
  location: string;
  uploadedAt: string;
  isSubImage: boolean;
};

type PhotosPage = {
  items: PhotoListItem[];
  total: number;
};

function ServiceCard({
  name,
  status,
  statusText,
  details,
  link,
  icon: Icon,
}: {
  name: string;
  status: ServiceStatus;
  statusText: string;
  details?: string;
  link: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const dotColor = {
    loading: "bg-slate-400",
    grey: "bg-slate-400 dark:bg-slate-600",
    green: "bg-emerald-500 shadow-[0_0_8px_#10b981]",
    yellow: "bg-amber-500 shadow-[0_0_8px_#f59e0b]",
    red: "bg-rose-500 shadow-[0_0_8px_#f43f5e]",
  }[status];

  return (
    <Card className="hover-elevate transition-all duration-300 flex flex-col justify-between" data-testid={`service-card-${name.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base font-semibold">{name}</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          {status === "loading" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : (
            <span className={`h-2.5 w-2.5 rounded-full ${dotColor}`} />
          )}
          <span className="text-xs font-medium text-muted-foreground">{statusText}</span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col justify-between flex-1">
        {details && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-3 h-8" title={details}>
            {details}
          </p>
        )}
        {!details && (
          <div className="h-8 mb-3" />
        )}
        <div className="flex justify-end">
          {status === "grey" ? (
            <Link href={link} className="text-xs text-primary font-medium hover:underline flex items-center gap-1">
              Setup Now <ChevronRight className="h-3 w-3" />
            </Link>
          ) : (
            <Link href={link} className="text-xs text-muted-foreground hover:text-foreground font-medium hover:underline flex items-center gap-1">
              Configure <ChevronRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RecentImagesCard() {
  const { data: photos, isLoading, error } = useQuery<PhotosPage>({
    queryKey: ["/api/photos", { limit: 6 }],
    queryFn: async () => {
      const res = await fetch("/api/photos?limit=6");
      if (!res.ok) throw new Error("Failed to fetch photos");
      return res.json();
    },
  });

  return (
    <Card className="h-full flex flex-col" data-testid="card-recent-images">
      <CardHeader>
        <CardTitle className="text-lg">Recently Added Images</CardTitle>
        <CardDescription>Latest uploads in the database</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-between">
        {isLoading ? (
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square w-full rounded-md" />
            ))}
          </div>
        ) : error || !photos || photos.items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-6 text-muted-foreground">
            <ImageIcon className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-xs">No images found</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {photos.items.map((photo) => (
              <Link
                key={photo.id}
                href={`~${imageDetailHref(photo.id, "/settings/home")}`}
                className="relative aspect-square overflow-hidden rounded-md bg-muted border hover:opacity-85 hover:scale-95 transition-all"
              >
                {photo.location ? (
                  <img
                    src={photo.location}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <ImageIcon className="h-4 w-4" />
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
        <div className="mt-4 pt-2 border-t flex justify-end">
          <Link href="/image-storage/table" className="text-xs text-primary font-medium hover:underline flex items-center gap-1">
            View Full Table <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function ImportExportCard() {
  const options = [
    {
      title: "Contacts",
      description: "Import from Google Contacts CSV.",
      icon: Users,
      url: "/import-export/contacts",
    },
    {
      title: "Social Media",
      description: "Import follower/following data.",
      icon: Share2,
      url: "/import-export/social-media",
    },
    {
      title: "Application Data",
      description: "XML backup export and restore.",
      icon: Database,
      url: "/import-export/application",
    },
    {
      title: "Image Pass In",
      description: "Inherit missing profile pictures.",
      icon: ImageIcon,
      url: "/import-export/image-pass-in",
    },
    {
      title: "Instagram XML Transfer",
      description: "XML transfers between CRM instances.",
      icon: Camera,
      url: "/import-export/instagram-xml",
    },
  ];

  return (
    <Card className="h-full flex flex-col" data-testid="card-import-export-options">
      <CardHeader>
        <CardTitle className="text-lg">Import & Export Options</CardTitle>
        <CardDescription>Data utilities and transfer tools</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-between">
        <div className="space-y-3">
          {options.map((opt) => (
            <Link
              key={opt.title}
              href={opt.url}
              className="flex items-center justify-between p-2 rounded-lg border hover:bg-muted/50 transition-colors group cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <opt.icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                <div className="text-left">
                  <h4 className="text-xs font-semibold">{opt.title}</h4>
                  <p className="text-[10px] text-muted-foreground line-clamp-1">{opt.description}</p>
                </div>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsHomePage() {
  // 1. PRM-face
  const { data: prmFaceSettings } = useQuery<PrmFaceSettings>({
    queryKey: ["/api/prm-face/settings"],
  });
  const { data: prmFaceTest, isLoading: isLoadingPrmFaceTest } = useQuery<TestResult>({
    queryKey: ["prm-face-test"],
    queryFn: async () => {
      const res = await fetch("/api/prm-face/test", { method: "POST" });
      if (!res.ok) throw new Error("Connection test failed");
      return res.json();
    },
    enabled: !!prmFaceSettings?.apiUrl,
  });

  // 2. Ollama
  const { data: ollamaSettings } = useQuery<OllamaSettings>({
    queryKey: ["/api/ollama/settings"],
  });
  const { data: ollamaTest, isLoading: isLoadingOllamaTest } = useQuery<TestResult>({
    queryKey: ["ollama-test"],
    queryFn: async () => {
      const res = await fetch("/api/ollama/test", { method: "POST" });
      if (!res.ok) throw new Error("Connection test failed");
      return res.json();
    },
    enabled: !!ollamaSettings?.apiUrl && ollamaSettings?.enabled,
  });

  // 3. Qdrant
  const { data: vectorSettings } = useQuery<VectorSettings>({
    queryKey: ["/api/vector/settings"],
  });
  const { data: vectorTest, isLoading: isLoadingVectorTest } = useQuery<TestResult>({
    queryKey: ["vector-test"],
    queryFn: async () => {
      const res = await fetch("/api/vector/test", { method: "POST" });
      if (!res.ok) throw new Error("Connection test failed");
      return res.json();
    },
    enabled: !!vectorSettings?.qdrantUrl && vectorSettings?.enabled,
  });

  // 4. PRM-osint
  const { data: osintSettings } = useQuery<OsintSettings>({
    queryKey: ["/api/osint/settings"],
  });
  const { data: osintTest, isLoading: isLoadingOsintTest } = useQuery<{ ok: boolean; tools?: any[]; error?: string }>({
    queryKey: ["osint-test"],
    queryFn: async () => {
      const res = await fetch("/api/osint/test", { method: "POST" });
      const data = await res.json();
      return data;
    },
    enabled: !!osintSettings?.apiUrl && osintSettings?.enabled,
    retry: false,
  });

  // Status mapping functions
  const prmFaceStatus = (() => {
    if (!prmFaceSettings?.apiUrl) return { status: "grey" as const, text: "Not Setup" };
    if (isLoadingPrmFaceTest) return { status: "loading" as const, text: "Testing..." };
    if (!prmFaceTest) return { status: "loading" as const, text: "Initializing..." };
    if (!prmFaceTest.ok) return { status: "red" as const, text: "Not Working", details: prmFaceTest.message };
    if (prmFaceTest.message?.includes("setup has not been completed") || !prmFaceSettings.hasApiKey) {
      return { status: "yellow" as const, text: "Setup Required", details: prmFaceTest.message };
    }
    return { status: "green" as const, text: "Online", details: prmFaceTest.message };
  })();

  const ollamaStatus = (() => {
    if (!ollamaSettings?.enabled || !ollamaSettings?.apiUrl) return { status: "grey" as const, text: "Not Setup" };
    if (isLoadingOllamaTest) return { status: "loading" as const, text: "Testing..." };
    if (!ollamaTest) return { status: "loading" as const, text: "Initializing..." };
    if (!ollamaTest.ok) return { status: "red" as const, text: "Not Working", details: ollamaTest.message };
    if (ollamaTest.message?.includes("0 models")) {
      return { status: "yellow" as const, text: "No Models Pulled", details: ollamaTest.message };
    }
    return { status: "green" as const, text: "Online", details: ollamaTest.message };
  })();

  const qdrantStatus = (() => {
    if (!vectorSettings?.enabled || !vectorSettings?.qdrantUrl) return { status: "grey" as const, text: "Not Setup" };
    if (isLoadingVectorTest) return { status: "loading" as const, text: "Testing..." };
    if (!vectorTest) return { status: "loading" as const, text: "Initializing..." };
    if (!vectorTest.ok) return { status: "red" as const, text: "Not Working", details: vectorTest.message };
    if (vectorTest.message?.includes("reachable but embedding failed")) {
      return { status: "yellow" as const, text: "Embedding Issue", details: vectorTest.message };
    }
    return { status: "green" as const, text: "Online", details: vectorTest.message };
  })();

  const osintStatus = (() => {
    if (!osintSettings?.enabled || !osintSettings?.apiUrl) return { status: "grey" as const, text: "Not Setup" };
    if (isLoadingOsintTest) return { status: "loading" as const, text: "Testing..." };
    if (!osintTest) return { status: "loading" as const, text: "Initializing..." };
    if (osintTest.ok === false || osintTest.error) {
      return { status: "red" as const, text: "Not Working", details: osintTest.error || "Unable to contact OSINT server" };
    }
    const count = osintTest.tools?.length ?? 0;
    return { status: "green" as const, text: "Online", details: `Connected. ${count} tool${count === 1 ? "" : "s"} available.` };
  })();

  return (
    <div className="container max-w-full md:max-w-6xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-settings-home-title">
          <Settings className="h-6 w-6" />
          Settings Home
        </h1>
        <p className="text-muted-foreground">
          Welcome to settings. Monitor active microservices, review recently added photos, and access import/export utilities.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
        {/* Column 1: Microservices */}
        <div className="space-y-4 flex flex-col">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Microservices & Services</h2>
          <div className="space-y-4 flex-1 flex flex-col justify-between">
            <ServiceCard
              name="PRM-face"
              status={prmFaceStatus.status}
              statusText={prmFaceStatus.text}
              details={prmFaceStatus.details}
              link="/recognition"
              icon={Scan}
            />
            <ServiceCard
              name="Ollama"
              status={ollamaStatus.status}
              statusText={ollamaStatus.text}
              details={ollamaStatus.details}
              link="/intelligence"
              icon={BrainCircuit}
            />
            <ServiceCard
              name="Qdrant"
              status={qdrantStatus.status}
              statusText={qdrantStatus.text}
              details={qdrantStatus.details}
              link="/vector"
              icon={Database}
            />
            <ServiceCard
              name="PRM-osint"
              status={osintStatus.status}
              statusText={osintStatus.text}
              details={osintStatus.details}
              link="/experimental"
              icon={Radar}
            />
          </div>
        </div>

        {/* Column 2: Recent Images */}
        <div className="space-y-4 flex flex-col">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Recent Activity</h2>
          <div className="flex-1">
            <RecentImagesCard />
          </div>
        </div>

        {/* Column 3: Import/Export */}
        <div className="space-y-4 flex flex-col">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Utilities</h2>
          <div className="flex-1">
            <ImportExportCard />
          </div>
        </div>
      </div>
    </div>
  );
}
