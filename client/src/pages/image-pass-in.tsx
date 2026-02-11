import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ImageIcon, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface ImagePassInResult {
  totalPeopleWithoutImages: number;
  updated: number;
  skipped: number;
  noSocialAccount: number;
  updates: { personId: string; personName: string; imageUrl: string }[];
}

export default function ImagePassInPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<ImagePassInResult | null>(null);

  const imagePassInMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/image-pass-in");
      return res.json() as Promise<ImagePassInResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      toast({
        title: "Image pass-in complete",
        description: `Updated ${data.updated} of ${data.totalPeopleWithoutImages} people without images.`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to run image pass-in. Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-semibold" data-testid="text-image-pass-in-title">Image Pass In</h1>
        <p className="text-muted-foreground">
          Automatically fill in missing profile images by pulling them from linked social accounts.
        </p>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pull Images from Social Accounts</CardTitle>
            <CardDescription>
              This will look at every person who doesn't have a profile image. If they have a linked social account with an image, that image will be applied as their profile picture.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={() => imagePassInMutation.mutate()}
              disabled={imagePassInMutation.isPending}
              data-testid="button-run-image-pass-in"
            >
              {imagePassInMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <ImageIcon className="mr-2 h-4 w-4" />
                  Run Image Pass In
                </>
              )}
            </Button>

            {result && (
              <div className="border rounded-md p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                  <span className="font-medium" data-testid="text-pass-in-summary">
                    {result.updated} updated out of {result.totalPeopleWithoutImages} people without images
                  </span>
                </div>

                <div className="text-sm text-muted-foreground space-y-1">
                  <p data-testid="text-no-social">{result.noSocialAccount} had no linked social accounts</p>
                  <p data-testid="text-skipped">{result.skipped} had social accounts but no images on them</p>
                </div>

                {result.updates.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <p className="text-sm font-medium">Updated people:</p>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {result.updates.map((update) => (
                        <div
                          key={update.personId}
                          className="flex items-center gap-3 text-sm"
                          data-testid={`row-updated-person-${update.personId}`}
                        >
                          <img
                            src={update.imageUrl}
                            alt={update.personName}
                            className="h-8 w-8 rounded-full object-cover"
                          />
                          <span>{update.personName}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {result.updated === 0 && result.totalPeopleWithoutImages === 0 && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <AlertCircle className="h-4 w-4" />
                    <span>All people already have profile images.</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
