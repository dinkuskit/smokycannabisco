import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Local workerd from the production build (`dist/server/wrangler.json`), the
 * way `npm run start` runs it but on a free port and, by default, on a fresh
 * throwaway state directory, so the pages render from the seed on an empty
 * D1. Shared by the smoke test and the live check.
 */

/** A free TCP port on the loopback interface. */
export async function reservePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/**
 * Start workerd and wait until it answers. Resolves with the worker handle;
 * rejects with the captured logs when the process exits or never answers.
 *
 * @param {{ root: string, persistTo?: string, readyTimeoutMs?: number }} options
 */
export async function startLocalWorker({ root, persistTo, readyTimeoutMs = 60_000 }) {
  const config = join(root, 'dist/server/wrangler.json');
  if (!existsSync(config)) throw new Error('run npm run build first: dist/server/wrangler.json is missing');
  const ownsState = !persistTo;
  const stateDir = persistTo ?? (await mkdtemp(join(tmpdir(), 'smokycannabisco-site-workerd-')));
  const port = await reservePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(
    join(root, 'node_modules/.bin/wrangler'),
    ['dev', '--local', '--persist-to', stateDir, '--port', String(port), '--ip', '127.0.0.1', '--config', config],
    { cwd: root, env: { ...process.env, CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let logs = '';
  const capture = (chunk) => {
    logs = (logs + chunk.toString()).slice(-100_000);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  let exited = false;
  const exit = new Promise((resolve) => {
    child.once('exit', () => {
      exited = true;
      resolve();
    });
    child.once('error', (error) => {
      logs += String(error);
      exited = true;
      resolve();
    });
  });

  const stop = async () => {
    if (!exited) {
      child.kill('SIGTERM');
      await Promise.race([exit, sleep(5000)]);
      if (!exited) {
        child.kill('SIGKILL');
        await exit;
      }
    }
    if (ownsState) await rm(stateDir, { recursive: true, force: true });
  };

  const deadline = Date.now() + readyTimeoutMs;
  while (!exited && Date.now() < deadline) {
    try {
      await fetch(`${base}/robots.txt`, { signal: AbortSignal.timeout(2000) });
      return { base, port, child, stateDir, logs: () => logs, exited: () => exited, stop };
    } catch {
      await sleep(500);
    }
  }
  await stop();
  throw new Error(`local workerd did not answer on ${base}\n${logs.slice(-4000)}`);
}
