import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Heart, MessageSquare, AtSign } from "lucide-react";
import RelationshipTypesList from "@/pages/relationship-types-list";
import InteractionTypesList from "@/pages/interaction-types-list";
import SocialAccountTypesList from "@/pages/social-account-types-list";

export default function DataTypesPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-3 md:px-6 py-2 md:py-4">
        <div className="mb-2 md:mb-4">
          <h1 className="text-3xl font-semibold" data-testid="text-data-types-title">
            Data Types
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage relationship types, interaction types, and social account types.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-3 md:px-6 py-4">
        <Tabs defaultValue="relationship-types" className="h-full flex flex-col">
          <TabsList className="mb-4 w-auto">
            <TabsTrigger value="relationship-types" className="flex items-center gap-2" data-testid="tab-relationship-types">
              <Heart className="h-4 w-4" />
              <span>Relationship Types</span>
            </TabsTrigger>
            <TabsTrigger value="interaction-types" className="flex items-center gap-2" data-testid="tab-interaction-types">
              <MessageSquare className="h-4 w-4" />
              <span>Interaction Types</span>
            </TabsTrigger>
            <TabsTrigger value="social-account-types" className="flex items-center gap-2" data-testid="tab-social-account-types">
              <AtSign className="h-4 w-4" />
              <span>Social Account Types</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="relationship-types" className="flex-1 mt-0">
            <RelationshipTypesContent />
          </TabsContent>
          <TabsContent value="interaction-types" className="flex-1 mt-0">
            <InteractionTypesContent />
          </TabsContent>
          <TabsContent value="social-account-types" className="flex-1 mt-0">
            <SocialAccountTypesContent />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/**
 * Inline wrappers that strip the full-page chrome from TypeListPage
 * and render just the list content within the tab panel.
 */
function RelationshipTypesContent() {
  return <RelationshipTypesList />;
}

function InteractionTypesContent() {
  return <InteractionTypesList />;
}

function SocialAccountTypesContent() {
  return <SocialAccountTypesList />;
}
