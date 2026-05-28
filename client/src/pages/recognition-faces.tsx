import { ScanFace } from "lucide-react";

export default function RecognitionFacesPage() {
  return (
    <div className="h-full overflow-auto">
      <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
        <div className="space-y-2 mb-6">
          <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-recognition-faces-title">
            <ScanFace className="h-6 w-6" />
            Faces
          </h1>
          <p className="text-muted-foreground">
            Manage face identities registered with PRM-Face.
          </p>
        </div>
      </div>
    </div>
  );
}
