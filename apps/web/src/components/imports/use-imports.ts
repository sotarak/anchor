import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";

export function useImports(project: string, env: string, path: string) {
  return useQuery({
    queryKey: qk.imports(project, env, path),
    queryFn: () => api.imports.list(project, env, path),
  });
}

/** An import change changes the import list and the composed secret list. */
function useInvalidateImports(project: string, env: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.importsAll(project, env) }),
      queryClient.invalidateQueries({ queryKey: qk.secretsAll(project, env) }),
    ]);
}

export function useCreateImport(project: string, env: string) {
  const invalidate = useInvalidateImports(project, env);
  return useMutation({
    mutationFn: (body: { path: string; source: { environment: string; path: string } }) =>
      api.imports.create(project, env, body),
    onSuccess: invalidate,
  });
}

export function useDeleteImport(project: string, env: string) {
  const invalidate = useInvalidateImports(project, env);
  return useMutation({
    mutationFn: (id: string) => api.imports.remove(project, env, id),
    onSuccess: invalidate,
  });
}
