import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";

type Target = { project: string; env: string; path: string; key: string };

/** Version metadata, newest first (as the API returns it). Values are fetched per reveal. */
export function useSecretVersions({ project, env, path, key }: Target, enabled = true) {
  return useQuery({
    queryKey: qk.secretVersions(project, env, path, key),
    queryFn: () => api.secrets.versions(project, env, key, path),
    enabled,
  });
}

export function useRollback({ project, env, path, key }: Target) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (version: number) => api.secrets.rollback(project, env, key, { path, version }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.secretsAll(project, env) }),
        queryClient.invalidateQueries({ queryKey: qk.overviewAll(project) }),
      ]),
  });
}
