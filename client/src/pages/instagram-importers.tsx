import { useState } from "react";
import { Link } from "wouter";
import { BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ImporterList } from "@/components/instagram-importer-list";
import { useImporters } from "@/lib/instagram";

function HowToCard({ defaultOpen }: { defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="mb-6">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none" data-testid="button-stories-howto">
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Learn how to use
              {open ? <ChevronDown className="ml-auto h-4 w-4" /> : <ChevronRight className="ml-auto h-4 w-4" />}
            </CardTitle>
            <CardDescription>What the story collector does, and the four steps to get it running.</CardDescription>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4 text-sm">
            <p>
              A small companion service (<code>prm-stories</code>) drives a real Chrome window that is logged in to an
              Instagram account. On each scheduled run it watches every story in the tray — including ones already
              seen — and sends each story's image plus its metadata here as soon as it finishes with each account. For a
              video story that image is its cover frame; turn on <em>Download videos</em> to keep the video too. Stories
              from accounts PRM has no social account for are dropped but recorded in the run log, so you can always see
              why one is missing. Every story remembers which account it was collected from.
            </p>
            <ol className="list-decimal list-inside space-y-2">
              <li>
                <strong>Start a service.</strong> <code>npm install</code> then <code>npm start</code> in a{" "}
                <code>prm-stories</code> folder. One install per Instagram account — give each its own{" "}
                <code>STORIES_PORT</code>.
              </li>
              <li>
                <strong>Add an importer.</strong> Press <em>+</em> below and enter the service URL
                (<code>http://localhost:5055</code> by default).
              </li>
              <li>
                <strong>Log in once.</strong> Press <em>Open Instagram login</em> on the card. A Chrome window opens on the
                service's own profile; sign in as you normally would, then close the window. The profile keeps the session,
                so you only repeat this when Instagram logs it out.
              </li>
              <li>
                <strong>Set the schedule and enable it.</strong> On{" "}
                <Link href="~/social-accounts/tracking" className="text-primary hover:underline">Social Accounts → Tracking</Link>, choose
                how often to run and the time-of-day window. PRM picks a random minute inside the window each time so the runs
                don't look automated. Press <em>Run now</em> there to check that everything works — it reports right away
                whether the login is still good.
              </li>
            </ol>
            <p className="text-muted-foreground">
              Keep each service on the same network its account normally uses, and set its <code>TZ</code> to the machine
              you logged in from.
            </p>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}


export default function InstagramImportersPage() {
  const { data: importers = [] } = useImporters();

  return (
    <div className="container max-w-full md:max-w-5xl py-3 md:py-8 px-4 md:pl-12">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Importers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Each importer is one Instagram account driven by its own prm-stories service. In the evening it collects the
          stories of everyone that account follows; in the morning it refreshes tracked accounts.
        </p>
      </div>

      <HowToCard defaultOpen={importers.length === 0} />

      <ImporterList />

      <p className="text-sm text-muted-foreground mb-6">
        Story images and videos go to the app-wide image storage, set under{" "}
        <Link href="~/settings/image-storage" className="text-primary hover:underline">Settings → Image Storage</Link>.
      </p>
    </div>
  );
}
