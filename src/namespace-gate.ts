/**
 * Pure decision logic for the /_emdash namespace. No Astro imports, so the
 * unit tests run it directly under Node.
 */
export const NAMESPACE = '/_emdash';
export const TEAM_DOMAIN_ENV = 'EMDASH_ACCESS_TEAM_DOMAIN';
export const AUDIENCE_ENV = 'CF_ACCESS_AUDIENCE';
export const ALLOWLIST_ENV = 'EMDASH_OPERATOR_ALLOWLIST';

export interface GateEnv {
  [TEAM_DOMAIN_ENV]?: string;
  [AUDIENCE_ENV]?: string;
  [ALLOWLIST_ENV]?: string;
}

export interface GateIdentity {
  email?: string;
}

export type Authenticate = (request: Request, config: { teamDomain: string; audienceEnvVar: string }) => Promise<GateIdentity | null | undefined>;

export interface GateInput {
  pathname: string;
  request: Request;
  env: GateEnv;
  authenticate: Authenticate;
  dev?: boolean;
}

export interface GateDecision {
  allow: boolean;
  reason: 'public' | 'dev' | 'access-not-configured' | 'no-identity' | 'not-on-allowlist' | 'operator';
}

/** Decode the way Astro routing does, then collapse repeated slashes. */
export function canonicalPathname(pathname: string): string {
  let path = pathname;
  for (let round = 0; round < 3; round += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      break;
    }
    if (decoded === path) break;
    path = decoded;
  }
  return path.replace(/\/{2,}/g, '/');
}

export function isEmdashNamespace(pathname: string): boolean {
  const path = canonicalPathname(pathname).toLowerCase();
  return path === NAMESPACE || path.startsWith(`${NAMESPACE}/`);
}

/** The pathname of the request itself, independent of Astro's parsed URL. */
export function requestPathname(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return '/';
  }
}

function parseAllowlist(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export async function evaluateGate(input: GateInput): Promise<GateDecision> {
  const candidates = [input.pathname, requestPathname(input.request)];
  if (!candidates.some(isEmdashNamespace)) return { allow: true, reason: 'public' };
  if (input.dev) return { allow: true, reason: 'dev' };

  const teamDomain = input.env[TEAM_DOMAIN_ENV]?.trim();
  const audience = input.env[AUDIENCE_ENV]?.trim();
  if (!teamDomain || !audience) return { allow: false, reason: 'access-not-configured' };

  let identity: GateIdentity | null | undefined;
  try {
    identity = await input.authenticate(input.request, { teamDomain, audienceEnvVar: AUDIENCE_ENV });
  } catch {
    identity = null;
  }
  const email = identity?.email?.trim().toLowerCase();
  if (!email) return { allow: false, reason: 'no-identity' };

  const allowlist = parseAllowlist(input.env[ALLOWLIST_ENV]);
  if (allowlist.length > 0 && !allowlist.includes(email)) return { allow: false, reason: 'not-on-allowlist' };
  return { allow: true, reason: 'operator' };
}

export function deniedResponse(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
    },
  });
}
