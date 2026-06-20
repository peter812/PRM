import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { Trophy, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GamesPage() {
  return (
    <div className="container mx-auto p-4 max-w-4xl space-y-6 mt-4">
      <div className="flex flex-col space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Games</h1>
        <p className="text-muted-foreground">
          Play games to interact with the PRM system.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-yellow-500" />
              ELO Ranking
            </CardTitle>
            <CardDescription>
              Rank people in head-to-head matchups.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="mb-6 text-sm text-muted-foreground">
              In this game, you'll be presented with two people. Choose the one that you think ranks higher. Your choices will help build a global ELO ranking across the platform.
            </p>
            <Button asChild className="w-full">
              <Link href="/elo-ranking">Play ELO Ranking</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-blue-500" />
              Guess the Sex
            </CardTitle>
            <CardDescription>
              Infer the sex of a person.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="mb-6 text-sm text-muted-foreground">
              A fun and quick game where you infer the sex of a person. This helps clean up our data and improves demographic modeling in the app.
            </p>
            <Button asChild className="w-full">
              <Link href="/guess-the-sex">Play Guess the Sex</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
