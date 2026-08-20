import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import type { SubGroup } from "@shared/schema";

export default function SubGroupProfile() {
  const { id, subGroupId } = useParams<{ id?: string; subGroupId?: string }>();
  const targetId = subGroupId || id;
  const [, navigate] = useLocation();

  const { data: subGroup, isLoading, isError } = useQuery<SubGroup>({
    queryKey: ["/api/subgroups", targetId],
    enabled: !!targetId,
  });

  useEffect(() => {
    if (subGroup?.groupId) {
      navigate(`/group/${subGroup.groupId}/subgroup/${subGroup.id}`, { replace: true });
    }
  }, [subGroup, navigate]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Skeleton className="h-12 w-48" />
      </div>
    );
  }

  if (isError || !subGroup) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center">
        <h2 className="text-xl font-semibold mb-2">Sub group not found</h2>
        <Button onClick={() => navigate("/groups")}>Back to Groups</Button>
      </div>
    );
  }

  return null;
}
