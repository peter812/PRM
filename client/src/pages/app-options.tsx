import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { FolderSync, ChevronRight } from "lucide-react";

export default function AppOptionsPage() {
  return (
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-semibold" data-testid="text-app-options-title">App Options</h1>
        <p className="text-muted-foreground">
          Configure application-level settings and data management.
        </p>
      </div>

      <Link href="/import-export">
        <Card className="hover-elevate cursor-pointer" data-testid="card-import-export-link">
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
            <div className="flex items-center gap-3">
              <FolderSync className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-lg">Import & Export</CardTitle>
                <CardDescription className="mt-1">Import contacts, messages, social media data, or export your full application backup</CardDescription>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
        </Card>
      </Link>
    </div>
  );
}
