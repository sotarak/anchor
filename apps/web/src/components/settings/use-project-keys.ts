import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";

export const ROTATION_POLL_MS = 3000;

/** Key versions and recent rotations; polls while the latest rotation is running. */
export function useProjectKeys(project: string) {
  return useQuery({
    queryKey: qk.keys(project),
    queryFn: () => api.keys.status(project),
    refetchInterval: (query) =>
      query.state.data?.rotations[0]?.status === "running" ? ROTATION_POLL_MS : false,
  });
}

/** Starts a rotation, or resumes the running one (the server decides). */
export function useRotateKey(project: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.keys.rotate(project),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.keys(project) }),
  });
}
