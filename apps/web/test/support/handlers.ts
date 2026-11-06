import type { EnvironmentDto, FolderDto, ProjectDto, UserDto } from "@anchor/shared";
import { HttpResponse, http } from "msw";
import { fixtures } from "./fixtures";
import { apiError, server } from "./msw";

/** GET /auth/me answers as `user`. */
export function signedInAs(user: UserDto = fixtures.owner) {
  server.use(http.get("/api/v1/auth/me", () => HttpResponse.json({ user })));
}

/** GET /auth/me answers 401; setup/status reports `needsSetup`. */
export function signedOut(opts: { needsSetup?: boolean } = {}) {
  server.use(
    http.get("/api/v1/auth/me", () => apiError(401, "unauthenticated", "Authentication required")),
    http.get("/api/v1/setup/status", () =>
      HttpResponse.json({ needsSetup: opts.needsSetup ?? false }),
    ),
  );
}

/** GET /projects/:slug and its environments. */
export function projectExists(
  project: ProjectDto = fixtures.project,
  environments: EnvironmentDto[] = fixtures.envs,
) {
  server.use(
    http.get(`/api/v1/projects/${project.slug}`, () => HttpResponse.json({ project })),
    http.get(`/api/v1/projects/${project.slug}/environments`, () =>
      HttpResponse.json({ environments }),
    ),
    http.get("/api/v1/projects", () => HttpResponse.json({ projects: [project] })),
  );
}

/**
 * GET /folders for one env (and an empty GET /imports, which a test can override): `byPath` maps a path to its child folders (missing path → none).
 * Records each requested URL.
 */
export function foldersAre(
  env: string,
  byPath: Record<string, FolderDto[]> = {},
  project = fixtures.project.slug,
) {
  const urls: URL[] = [];
  server.use(
    http.get(`/api/v1/projects/${project}/environments/${env}/folders`, ({ request }) => {
      const url = new URL(request.url);
      urls.push(url);
      return HttpResponse.json({ folders: byPath[url.searchParams.get("path") ?? "/"] ?? [] });
    }),
    http.get(`/api/v1/projects/${project}/environments/${env}/imports`, () =>
      HttpResponse.json({ imports: [] }),
    ),
  );
  return { urls };
}
