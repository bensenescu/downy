import { createRemoteJWKSet, jwtVerify } from "jose";

type AccessResult =
  | { ok: true; email: string; sub: string }
  | { ok: false; reason: "config_missing" | "no_token" | "invalid_token" };

// JWKS clients are cached per team domain so we don't refetch certs on every
// request. `createRemoteJWKSet` returns a function that lazily fetches and
// caches the JWKS; one instance per team domain is enough for the isolate.
const jwksByTeamDomain = new Map<
  string,
  ReturnType<typeof createRemoteJWKSet>
>();

function getJwks(teamDomain: string) {
  const existing = jwksByTeamDomain.get(teamDomain);
  if (existing) return existing;
  const jwks = createRemoteJWKSet(
    new URL(`${teamDomain}/cdn-cgi/access/certs`),
  );
  jwksByTeamDomain.set(teamDomain, jwks);
  return jwks;
}

function normalizeTeamDomain(raw: string): string | null {
  try {
    const parsed = new URL(raw.trim().replace(/\/+$/, ""));
    if (parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export async function verifyAccessJwt(
  request: Request,
  env: Cloudflare.Env,
): Promise<AccessResult> {
  const teamDomain = env.TEAM_DOMAIN
    ? normalizeTeamDomain(env.TEAM_DOMAIN)
    : null;
  const policyAud = env.POLICY_AUD?.trim() || null;
  if (!teamDomain || !policyAud) {
    return { ok: false, reason: "config_missing" };
  }

  // Cloudflare Access forwards the JWT in this header on every request once
  // Access is enabled on the route. The cookie copy (`CF_Authorization`) is a
  // fallback for browser navigations where the header isn't preserved.
  const token =
    request.headers.get("cf-access-jwt-assertion") ??
    readCookie(request.headers.get("cookie"), "CF_Authorization");
  if (!token) return { ok: false, reason: "no_token" };

  try {
    const { payload } = await jwtVerify(token, getJwks(teamDomain), {
      issuer: teamDomain,
      audience: policyAud,
    });
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    const email = typeof payload.email === "string" ? payload.email : null;
    if (!sub || !email) return { ok: false, reason: "invalid_token" };
    return { ok: true, email, sub };
  } catch {
    return { ok: false, reason: "invalid_token" };
  }
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}
