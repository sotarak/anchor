import type { EnvironmentDto, ProjectDto, UserDto } from "@anchor/shared";
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
