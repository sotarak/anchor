// Demo data for the README media, created through the public API on a fresh local instance.
// Every value is fake; nothing here looks like a real credential or an Anchor token.

export const DEMO_OWNER = {
  name: "Maya Chen",
  email: "maya@acme.dev",
  password: "demo-password-123",
};

const PROJECTS = [
  { name: "Payments API", slug: "payments-api" },
  { name: "Web storefront", slug: "web-storefront" },
  { name: "Data pipeline", slug: "data-pipeline" },
];

/** [key, value, comment]. Staging gets the first six, so the overview shows two "Missing". */
const SECRETS: [string, string, string][] = [
  ["DATABASE_URL", "postgres://app:demo@db.internal:5432/payments", "Primary Postgres"],
  ["STRIPE_SECRET_KEY", "sk_test_demo_not_a_real_key", "Rotated quarterly"],
  ["STRIPE_WEBHOOK_SECRET", "whsec_demo_not_a_real_secret", ""],
  ["REDIS_URL", "redis://cache.internal:6379/0", "Session cache"],
  ["SENTRY_DSN", "https://public@sentry.example.com/1", ""],
  ["JWT_SIGNING_KEY", "demo-signing-key-not-real", "HS256, shared with the gateway"],
  ["LOG_LEVEL", "info", ""],
  ["API_BASE_URL", "https://api.payments.example.com", ""],
];

async function call(
  baseURL: string,
  token: string | null,
  method: string,
  path: string,
  body?: unknown,
) {
  const res = await fetch(`${baseURL}/api/v1${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Creates the owner and the demo projects; returns the owner's credentials for signing in. */
export async function seedDemo(baseURL: string): Promise<{ email: string; password: string }> {
  await call(baseURL, null, "POST", "/setup", DEMO_OWNER);
  const login = await call(baseURL, null, "POST", "/auth/login", {
    email: DEMO_OWNER.email,
    password: DEMO_OWNER.password,
    client: "cli",
  });
  const api = (method: string, path: string, body?: unknown) =>
    call(baseURL, login.token, method, path, body);

  for (const p of PROJECTS) await api("POST", "/projects", p);

  const env = (slug: string) => `/projects/payments-api/environments/${slug}`;
  for (const [slug, count] of [
    ["dev", SECRETS.length],
    ["staging", 6],
    ["prod", SECRETS.length],
  ] as const) {
    for (const [key, value, comment] of SECRETS.slice(0, count)) {
      await api("PUT", `${env(slug)}/secrets/${key}`, { value, comment });
    }
  }
  // A second version for the History shot.
  await api("PUT", `${env("prod")}/secrets/LOG_LEVEL`, { value: "warn", comment: "" });
  await api("POST", `${env("prod")}/folders`, { path: "/billing" });
  await api("PUT", `${env("prod")}/secrets/INVOICE_PREFIX`, {
    value: "ACME-",
    comment: "",
    path: "/billing",
  });
  await api("POST", "/projects/payments-api/service-tokens", {
    name: "github-actions-deploy",
    permission: "read",
    scopes: [{ environment: "prod", path: "/" }],
    expiresInDays: 90,
  });
  await api("POST", "/invites", { email: "dev@acme.dev", role: "member" });
  return { email: DEMO_OWNER.email, password: DEMO_OWNER.password };
}
