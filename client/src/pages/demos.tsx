import { Link } from "wouter";
import { Mic, Map as MapIcon, Cloud, SlidersHorizontal, Bell, Globe, BookUser, ScanFace, Link2, Trophy, Compass, MessageSquareText } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function DemosPage() {
  return (
    <div className="h-full overflow-auto">
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
        <Link href="/demos/whisper">
          <Card className="hover:bg-accent cursor-pointer transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mic className="h-5 w-5" />
                Whisper Demo
              </CardTitle>
              <CardDescription>
                Transcribe recordings or uploaded audio with timed, clickable segments.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/demos/map">
          <Card className="hover:bg-accent cursor-pointer transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapIcon className="h-5 w-5" />
                Map
              </CardTitle>
              <CardDescription>
                People pinned on a map by their address.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/demos/google-map">
          <Card className="hover:bg-accent cursor-pointer transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Google Map
              </CardTitle>
              <CardDescription>
                The same pins on Google Maps, with satellite imagery and Street View.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/demos/word-cloud">
          <Card className="hover:bg-accent cursor-pointer transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cloud className="h-5 w-5" />
                Word Cloud
              </CardTitle>
              <CardDescription>
                Turn any text into a word cloud with shape, color, and emotion options.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/demos/bio-word-cloud">
          <Card className="hover:bg-accent cursor-pointer transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cloud className="h-5 w-5" />
                Bio Word Cloud
              </CardTitle>
              <CardDescription>
                Every social account bio combined into one word cloud.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/demos/image-summary-word-cloud">
          <Card className="hover:bg-accent cursor-pointer transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cloud className="h-5 w-5" />
                Image Summary Word Cloud
              </CardTitle>
              <CardDescription>
                The most common words across every AI image summary, counted in the background and saved.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/demos/ollama-params">
          <Card className="hover:bg-accent cursor-pointer transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SlidersHorizontal className="h-5 w-5" />
                Ollama Model Params
              </CardTitle>
              <CardDescription>
                Inspect a model's capabilities, thinking support, and default parameters.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/demos/event-log">
          <Card className="hover:bg-accent cursor-pointer transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Event Log
              </CardTitle>
              <CardDescription>
                Generate generic events and mark them seen or acknowledged.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/demos/roster-import">
          <Card className="hover:bg-accent cursor-pointer transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookUser className="h-5 w-5" />
                Yearbook &amp; Playbill Import
              </CardTitle>
              <CardDescription>
                Save the faces, names and bios on a yearbook or playbill page as references.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/demos/references">
          <Card className="hover:bg-accent cursor-pointer transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ScanFace className="h-5 w-5" />
                References
              </CardTitle>
              <CardDescription>
                Browse imported references by name or keyword, or search them by face.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/demos/account-matching">
          <Card className="hover:bg-accent cursor-pointer transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="h-5 w-5" />
                Account Matching
              </CardTitle>
              <CardDescription>
                Link social accounts to people one at a time from suggested matches.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/demos/elo-ranking">
          <Card className="hover:bg-accent cursor-pointer transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5" />
                ELO Ranking
              </CardTitle>
              <CardDescription>
                Pick the higher-ranked of two people to build an ELO ranking of your contacts.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/demos/political-leaning">
          <Card className="hover:bg-accent cursor-pointer transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Compass className="h-5 w-5" />
                Political Leaning
              </CardTitle>
              <CardDescription>
                Place contacts on the political compass, skipping anyone you are unsure of.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/demos/describe-me">
          <Card className="hover:bg-accent cursor-pointer transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquareText className="h-5 w-5" />
                Describe Me
              </CardTitle>
              <CardDescription>
                Describe a random person out loud; the confirmed bullet points are saved as a note on their profile.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>

    </div>
    </div>
  );
}
