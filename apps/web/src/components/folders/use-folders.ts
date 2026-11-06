import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";

/** Direct child folders of `path` (explicit folders and folders implied by secret paths). */
export function useFolders(project: string, env: string, path: string) {
  return useQuery({
    queryKey: qk.folders(project, env, path),
    queryFn: () => api.folders.list(project, env, path),
  });
}

/** A folder write changes folder lists, secret lists (force delete) and the overview. */
function useInvalidateTree(project: string, env: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.foldersAll(project, env) }),
      queryClient.invalidateQueries({ queryKey: qk.secretsAll(project, env) }),
      queryClient.invalidateQueries({ queryKey: qk.overviewAll(project) }),
    ]);
}

export function useCreateFolder(project: string, env: string) {
  const invalidate = useInvalidateTree(project, env);
  return useMutation({
    mutationFn: (path: string) => api.folders.create(project, env, path),
    onSuccess: invalidate,
  });
}

export function useDeleteFolder(project: string, env: string) {
  const invalidate = useInvalidateTree(project, env);
  return useMutation({
    mutationFn: ({ path, force }: { path: string; force: boolean }) =>
      api.folders.remove(project, env, path, force),
    onSuccess: invalidate,
  });
}
