import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { Users, Share2, Database, ChevronRight, ImageIcon } from "lucide-react";

const importExportSections = [
  {
    title: "Contacts",
    description: "Import people from a Google Contacts CSV export. Names, emails, phone numbers, and tags are automatically parsed and added to your contact list.",
    icon: Users,
    url: "/import-export/contacts",
  },
  {
    title: "Social Media",
    description: "Import follower and following data from social media platforms like Instagram. Connect imported accounts to your existing social profiles.",
    icon: Share2,
    url: "/import-export/social-media",
  },
  {
    title: "Application Data",
    description: "Export all your CRM data to an XML backup file, or restore from a previous backup. Includes people, relationships, groups, interactions, notes, social accounts, and more.",
    icon: Database,
    url: "/import-export/application",
  },
  {
    title: "Image Pass In",
    description: "Automatically fill in missing profile images by pulling them from linked social accounts. People without a profile picture will inherit an image from their first social account that has one.",
    icon: ImageIcon,
    url: "/import-export/image-pass-in",
  },
];

export default function ImportExportHome() {
  return (
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-semibold" data-testid="text-import-export-title">Import & Export</h1>
        <p className="text-muted-foreground">
          Manage your data by importing contacts and social media connections, or export your entire application for backup.
        </p>
      </div>

      <div className="space-y-4">
        {importExportSections.map((section) => (
          <Link key={section.title} href={section.url}>
            <Card className="hover-elevate cursor-pointer" data-testid={`card-${section.title.toLowerCase().replace(/\s+/g, '-')}`}>
              <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
                <div className="flex items-center gap-3">
                  <section.icon className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-lg">{section.title}</CardTitle>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm">
                  {section.description}
                </CardDescription>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
