import { UnifiedSetupDialog } from "@/components/unified-setup-dialog";

export default function UnifiedSetupPage() {
  return (
    <div className="container max-w-full md:max-w-6xl py-3 md:py-6 px-4 md:pl-12 mx-auto md:mx-0 h-[88vh]">
      <UnifiedSetupDialog inline initialStep={0} />
    </div>
  );
}
