import { Link } from "wouter";
import { Scan, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function DemosPage() {
  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Demos</h1>
        <p className="text-muted-foreground text-lg">
          Explore our current demos and previews of upcoming features. These demos showcase
          experimental capabilities that are actively being developed and refined.
        </p>
      </div>

      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-2">Current Developments</h2>
        <p className="text-muted-foreground">
          We are actively working on facial recognition, AI-powered descriptions, and intelligent
          chat capabilities. These demos represent the current state of our research and development
          efforts, and will continue to evolve as we refine the underlying technology.
        </p>
      </div>

      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-2">Future Plans</h2>
        <p className="text-muted-foreground">
          Our roadmap includes deeper integration of AI features directly into PRM workflows,
          improved accuracy for face recognition, and more intelligent relationship insights
          powered by large language models.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/prm-face-demo">
          <Card className="hover:bg-accent cursor-pointer transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scan className="h-5 w-5" />
                PRM Face Demo
              </CardTitle>
              <CardDescription>
                Test facial recognition capabilities with real-time detection.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/prm-face-save-demo">
          <Card className="hover:bg-accent cursor-pointer transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scan className="h-5 w-5" />
                PRM Face Save Demo
              </CardTitle>
              <CardDescription>
                Save and manage recognized faces for future identification.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/ai-desc-demo">
          <Card className="hover:bg-accent cursor-pointer transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                AI Description Demo
              </CardTitle>
              <CardDescription>
                Generate AI-powered descriptions from images and context.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>


      </div>
    </div>
  );
}
