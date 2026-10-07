import { authenticate as accessAuthenticate } from '@emdash-cms/cloudflare/auth';
import { env as workerEnv } from 'cloudflare:workers';

const SERVICE_CLIENT_ID = 'EMDASH_SERVICE_TOKEN_CLIENT_ID';
const SERVICE_CLIENT_SECRET = 'REDACTED';

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
 * dedicated service-token secrets are configured on the Worker.
 */
export async function authenticate(request: Request, config: unknown) {
  const clientId = readEnv(SERVICE_CLIENT_ID);
  const clientSecret = readEnv(SERVICE_CLIENT_SECRET);
  if (
    clientId &&
    clientSecret &&
    request.headers.get('CF-Access-Client-Id') === clientId &&
    request.headers.get('CF-Access-Client-Secret') === clientSecret
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
