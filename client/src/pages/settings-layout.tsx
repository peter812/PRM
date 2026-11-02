import { Route, Switch, Redirect } from "wouter";
import { Loader2 } from "lucide-react";
import { lazy, Suspense } from "react";

export { SettingsSidebar } from "@/components/settings-sidebar";

const SettingsHomePage = lazy(() => import("@/pages/settings-home"));
const UnifiedSetupPage = lazy(() => import("@/pages/unified-setup-page"));
const UserOptionsPage = lazy(() => import("@/pages/user-options"));
const AppOptionsPage = lazy(() => import("@/pages/app-options"));
const SearchSettingsPage = lazy(() => import("@/pages/search-settings"));
const DataTypesPage = lazy(() => import("@/pages/data-types"));
const ApiSettingsPage = lazy(() => import("@/pages/api-settings"));
const ChromeExtensionSettingsPage = lazy(() => import("@/pages/chrome-extension-settings"));
const ApiDocs = lazy(() => import("@/pages/api-docs"));
const DeleteOptionsPage = lazy(() => import("@/pages/delete-options"));
const ImportExportHome = lazy(() => import("@/pages/import-export-home"));
const ImportContactsPage = lazy(() => import("@/pages/import-contacts"));
const BackupsPage = lazy(() => import("@/pages/backups-page"));
const ImportMessagesPage = lazy(() => import("@/pages/import-messages"));
const ExtensionImportsSettingsPage = lazy(() => import("@/pages/extension-imports-settings"));
const TasksSettingsPage = lazy(() => import("@/pages/tasks-settings"));
const ImageStorageSettingsPage = lazy(() => import("@/pages/image-storage-settings"));
const ImageTablePage = lazy(() => import("@/pages/image-table-page"));
const ImageTasksSettingsPage = lazy(() => import("@/pages/image-tasks-settings"));
const RecognitionSettingsPage = lazy(() => import("@/pages/recognition-settings"));
const SocialGraphSettingsPage = lazy(() => import("@/pages/social-graph-settings"));
const InstagramImportersPage = lazy(() => import("@/pages/instagram-importers"));
const InstagramTrackingPage = lazy(() => import("@/pages/instagram-tracking"));
const InstagramPostsPage = lazy(() => import("@/pages/instagram-posts"));
const SocialTasksPage = lazy(() => import("@/pages/social-tasks"));
const OsintTasksPage = lazy(() => import("@/pages/osint-tasks"));
const SummaryTasksPage = lazy(() => import("@/pages/summary-tasks"));
const IntelligenceSettingsPage = lazy(() => import("@/pages/intelligence-settings"));
const IntelligenceToolsSettingsPage = lazy(() => import("@/pages/intelligence-tools-settings"));
const IntelligenceExternalToolsSettingsPage = lazy(() => import("@/pages/intelligence-external-tools-settings"));
const IntelligenceImagesSettingsPage = lazy(() => import("@/pages/intelligence-images-settings"));
const PromptsSettingsPage = lazy(() => import("@/pages/prompts-settings"));
const VectorSettingsPage = lazy(() => import("@/pages/vector-settings"));
const OsintSettingsPage = lazy(() => import("@/pages/osint-settings"));
const MapsSettingsPage = lazy(() => import("@/pages/maps-settings"));
const TaskDetailPage = lazy(() => import("@/pages/task-detail"));
const NotFound = lazy(() => import("@/pages/not-found"));

export default function SettingsLayout() {
  return (
    <div className="flex-1 overflow-auto h-full">
      <Suspense fallback={
        <div className="flex items-center justify-center h-full w-full">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }>
        <Switch>
          <Route path="/" component={() => <Redirect to="/home" />} />
          <Route path="/home" component={SettingsHomePage} />
          <Route path="/setup" component={UnifiedSetupPage} />
          <Route path="/user" component={UserOptionsPage} />
          <Route path="/app" component={AppOptionsPage} />
          <Route path="/search" component={SearchSettingsPage} />
          <Route path="/maps" component={MapsSettingsPage} />
          <Route path="/data-types" component={DataTypesPage} />
          <Route path="/image-tasks" component={ImageTasksSettingsPage} />
          <Route path="/image-storage/tasks" component={ImageTasksSettingsPage} />
          <Route path="/image-storage/table" component={ImageTablePage} />
          <Route path="/image-storage/faces" component={() => <Redirect to="~/faces" />} />
          <Route path="/image-storage" component={ImageStorageSettingsPage} />
          <Route path="/intelligence/tools" component={IntelligenceToolsSettingsPage} />
          <Route path="/intelligence/external-tools" component={IntelligenceExternalToolsSettingsPage} />
          <Route path="/intelligence/images" component={IntelligenceImagesSettingsPage} />
          <Route path="/intelligence/prompts" component={PromptsSettingsPage} />
          <Route path="/intelligence" component={IntelligenceSettingsPage} />
          <Route path="/vector" component={VectorSettingsPage} />
          <Route path="/osint" component={OsintSettingsPage} />
          <Route path="/import-export/instagram-xml" component={() => <Redirect to="/import-export" />} />
          <Route path="/instagram/tracking" component={InstagramTrackingPage} />
          <Route path="/instagram/posts" component={InstagramPostsPage} />
          <Route path="/instagram/runs" component={() => <Redirect to="/tasks/social" />} />
          <Route path="/instagram" component={InstagramImportersPage} />
          <Route path="/tasks/social" component={SocialTasksPage} />
          <Route path="/tasks/osint" component={OsintTasksPage} />
          <Route path="/tasks/summaries" component={SummaryTasksPage} />
          <Route path="/social-tasks" component={SocialTasksPage} />
          <Route path="/tasks" component={TasksSettingsPage} />
          <Route path="/task/:id" component={TaskDetailPage} />
          <Route path="/social-graph" component={SocialGraphSettingsPage} />
          <Route path="/recognition/faces" component={() => <Redirect to="~/faces" />} />
          <Route path="/recognition" component={RecognitionSettingsPage} />
          <Route path="/import-export/stories" component={() => <Redirect to="/instagram" />} />
          <Route path="/import-export/contacts" component={ImportContactsPage} />
          <Route path="/import-export/social-media" component={() => <Redirect to="/import-export" />} />
          <Route path="/import-export/messages" component={ImportMessagesPage} />
          <Route path="/import-export/extension-imports" component={ExtensionImportsSettingsPage} />
          <Route path="/import-export/backups" component={BackupsPage} />
          <Route path="/backups" component={BackupsPage} />
          <Route path="/import-export/application" component={() => <Redirect to="/import-export/backups" />} />
          <Route path="/import-export/image-pass-in" component={() => <Redirect to="/import-export" />} />
          <Route path="/import-export" component={ImportExportHome} />
          <Route path="/chrome-extension" component={ChromeExtensionSettingsPage} />
          <Route path="/api/settings" component={ApiSettingsPage} />
          <Route path="/api" component={ApiDocs} />
          <Route path="/delete" component={DeleteOptionsPage} />
          <Route path="/social-accounts/:uuid*">
            {(params: any) => {
              const search = typeof window !== "undefined" ? window.location.search : "";
              return <Redirect to={`~/social-accounts/${params?.uuid || ""}${search}`} replace />;
            }}
          </Route>
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </div>
  );
}
