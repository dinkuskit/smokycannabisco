import { authenticate as accessAuthenticate } from '@emdash-cms/cloudflare/auth';
import { env as workerEnv } from 'cloudflare:workers';

const SERVICE_CLIENT_SECRET = 'REDACTED';
const SERVICE_HEADER = 'X-Smoky-Preview-CMS-Token';

function readEnv(name: string): string | undefined {
  try {
    const value = (workerEnv as unknown as Record<string, unknown> | undefined)?.[name];
    if (typeof value === 'string' && value.trim()) return value;
  } catch {
  }
  try {
    const value = typeof process !== 'undefined' ? process.env?.[name] : undefined;
    if (typeof value === 'string' && value.trim()) return value;
  } catch {
  }
  return undefined;
}

/**
 * Cloudflare Access service-token requests do not carry an Access JWT, so the
 * official adapter cannot authenticate them. The bridge is inert unless both
 * dedicated service-token credentials are configured on the Worker. Access
 * validates the service token at the edge, while the explicit bridge header
 * carries the same secret to the Worker for the origin-side auth check.
 */
export async function authenticate(request: Request, config: unknown) {
  const clientSecret = readEnv(SERVICE_CLIENT_SECRET);
  if (
    clientSecret &&
    request.headers.get(SERVICE_HEADER) === clientSecret
  ) {
    return {
      email: 'agent@smokyproduct.co',
      name: 'Preview CMS service token',
      role: 50,
      subject: `service-token:${clientId}`,
    };
  }
  return accessAuthenticate(request, config);
}
