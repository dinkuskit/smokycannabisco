import { defineMiddleware } from 'astro:middleware';
import { authenticate as accessAuthenticate } from '@emdash-cms/cloudflare/auth';
import { env as workerEnv } from 'cloudflare:workers';
import {
  ALLOWLIST_ENV,
  AUDIENCE_ENV,
  TEAM_DOMAIN_ENV,
  deniedResponse,
  evaluateGate,
  isEmdashNamespace,
  requestPathname,
  type GateEnv,
} from './namespace-gate.ts';

/**
 * The team domain is the build input that also wires EmDash's `access()` in
 * astro.config.mjs, so the guard and the CMS auth are always configured
 * together. The audience and allowlist are runtime values: Worker bindings
 * first (`cloudflare:workers` env, which also carries Wrangler secrets), then
 * `process.env` (populated by the `nodejs_compat_populate_process_env` flag).
 * Every read is guarded: a failure reads as "not configured", never as
 * "allowed".
 */
function readEnv(): GateEnv {
  const read = (name: string): string | undefined => {
    try {
      const fromWorker = (workerEnv as unknown as Record<string, unknown> | undefined)?.[name];
      if (typeof fromWorker === 'string' && fromWorker.trim()) return fromWorker;
    } catch {
      // binding access failed; fall through
    }
    try {
      const fromProcess = typeof process !== 'undefined' ? process.env?.[name] : undefined;
      if (typeof fromProcess === 'string' && fromProcess.trim()) return fromProcess;
    } catch {
      // no process env in this runtime
    }
    return undefined;
  };
  const buildTeamDomain = import.meta.env.EMDASH_ACCESS_TEAM_DOMAIN;
  return {
    [TEAM_DOMAIN_ENV]: typeof buildTeamDomain === 'string' && buildTeamDomain.trim() ? buildTeamDomain : undefined,
    [AUDIENCE_ENV]: read(AUDIENCE_ENV),
    [ALLOWLIST_ENV]: read(ALLOWLIST_ENV),
  };
}

/**
 * Outer middleware, registered before EmDash. Production builds answer 404 for
 * the whole /_emdash namespace, including setup and login, unless Cloudflare
 * Access is configured, the official Access authentication succeeds, and the
 * identity is on the operator allowlist when one is set. Development builds
 * pass the namespace through so the local editor works. Host, forwarded
 * headers, Origin, cookies and query strings are never an unlock.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = context.url.pathname;
  const inNamespace = isEmdashNamespace(pathname) || isEmdashNamespace(requestPathname(context.request));
  if (!inNamespace) return next();
  if (import.meta.env.DEV) return next();
  try {
    const decision = await evaluateGate({
      pathname,
      request: context.request,
      env: readEnv(),
      authenticate: (request, config) => accessAuthenticate(request, config),
      dev: false,
    });
    return decision.allow ? next() : deniedResponse();
  } catch {
    return deniedResponse();
  }
});
