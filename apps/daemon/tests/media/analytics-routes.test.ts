import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { closeDatabase } from '../../src/db.js';
import { startServer } from '../../src/server.js';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2uoAAAAASUVORK5CYII=';
const PRIVATE_PROMPT = 'PRIVATE_PROMPT_NEVER_REPORT';
const PRIVATE_RESPONSE_BODY = 'PRIVATE_UPSTREAM_BODY_NEVER_REPORT';
const PRIVATE_API_KEY = 'PRIVATE_API_KEY_NEVER_REPORT';

type StartedServer = {
  url: string;
  server: Server;
  shutdown?: () => Promise<void> | void;
};

type PostHogEvent = {
  event: string;
  properties: Record<string, unknown>;
};

describe('media generation analytics', () => {
  const originalEnv = snapshotEnv();
  let daemon: StartedServer | null = null;
  let provider: Server | null = null;
  let ingestion: Server | null = null;

  afterEach(async () => {
    await Promise.resolve(daemon?.shutdown?.());
    await closeServer(daemon?.server ?? null);
    await closeServer(provider);
    await closeServer(ingestion);
    daemon = null;
    provider = null;
    ingestion = null;
    closeDatabase();
    restoreEnv(originalEnv);
  });

  it('preserves provider retries without reporting media analytics despite inherited credentials', async () => {
    const captured: PostHogEvent[] = [];
    const ingestionStarted = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        const compressed = Buffer.concat(chunks);
        const raw = req.headers['content-encoding'] === 'gzip'
          ? gunzipSync(compressed)
          : compressed;
        const body = JSON.parse(raw.toString('utf8')) as { batch?: PostHogEvent[] };
        captured.push(...(body.batch ?? []));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });
    ingestion = ingestionStarted.server;

    const attemptsByPrompt = new Map<string, number>();
    const providerStarted = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { prompt?: string };
        const prompt = body.prompt ?? '';
        const attempt = (attemptsByPrompt.get(prompt) ?? 0) + 1;
        attemptsByPrompt.set(prompt, attempt);

        if (prompt.includes('always-fail') || attempt === 1) {
          res.writeHead(429, {
            'content-type': 'application/json',
            'retry-after': '0',
          });
          res.end(JSON.stringify({ error: { message: PRIVATE_RESPONSE_BODY } }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }));
      });
    });
    provider = providerStarted.server;

    process.env.POSTHOG_KEY = 'phc_media_test';
    process.env.POSTHOG_HOST = ingestionStarted.url;
    process.env.NO_PROXY = '127.0.0.1,localhost';
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.ALL_PROXY;
    delete process.env.OD_MEDIA_ALLOW_STUBS;

    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('test setup did not provide OD_DATA_DIR');
    await writeFile(path.join(dataDir, 'media-config.json'), JSON.stringify({
      providers: {
        'custom-image': {
          apiKey: PRIVATE_API_KEY,
          baseUrl: `${providerStarted.url}/v1`,
          model: 'acme-image-model',
        },
      },
    }));

    daemon = await startServer({ port: 0, returnServer: true }) as StartedServer;
    await putAppConfig(daemon.url, {
      installationId: 'media-installation-test',
      telemetry: { metrics: true, content: false, artifactManifest: false },
      privacyDecisionAt: Date.now(),
    });

    const projectId = `media_analytics_${randomUUID()}`;
    const projectResponse = await fetch(`${daemon.url}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        name: 'Media analytics probe',
        metadata: { kind: 'prototype' },
        skipDiscoveryBrief: true,
      }),
    });
    expect(projectResponse.status).toBe(200);

    const successTaskId = await generateAndWait(
      daemon.url,
      projectId,
      `${PRIVATE_PROMPT} retry-success`,
      'done',
      false,
    );
    const failedTaskId = await generateAndWait(daemon.url, projectId, `${PRIVATE_PROMPT} always-fail`, 'failed');
    expect(successTaskId).toBeTruthy();
    expect(failedTaskId).toBeTruthy();
    expect(attemptsByPrompt.get(`${PRIVATE_PROMPT} retry-success`)).toBe(2);
    expect(attemptsByPrompt.get(`${PRIVATE_PROMPT} always-fail`)).toBe(2);
    expect(captured).toEqual([]);

    await putAppConfig(daemon.url, {
      telemetry: { metrics: false, content: false, artifactManifest: false },
    });
    await generateAndWait(daemon.url, projectId, `${PRIVATE_PROMPT} opted-out`, 'done', false);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(captured).toEqual([]);
  });
});

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ server: Server; url: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing server address');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function putAppConfig(url: string, patch: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${url}/api/app-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  expect(response.status).toBe(200);
}

async function generateAndWait(
  url: string,
  projectId: string,
  prompt: string,
  expectedStatus: 'done' | 'failed' = 'done',
  includeAnalyticsHeaders = true,
): Promise<string> {
  const response = await fetch(`${url}/api/projects/${encodeURIComponent(projectId)}/media/generate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(includeAnalyticsHeaders
        ? {
            'x-od-analytics-device-id': 'media-device-test',
            'x-od-analytics-session-id': 'media-session-test',
            'x-od-analytics-client-type': 'web',
            'x-od-analytics-locale': 'en',
          }
        : {}),
    },
    body: JSON.stringify({
      surface: 'image',
      model: 'custom-image',
      prompt,
      output: `${expectedStatus}-${randomUUID()}.png`,
    }),
  });
  expect(response.status).toBe(202);
  const { taskId } = await response.json() as { taskId: string };

  const waitResponse = await fetch(`${url}/api/media/tasks/${encodeURIComponent(taskId)}/wait`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ since: 0, timeoutMs: 5_000 }),
  });
  expect(waitResponse.status).toBe(200);
  const task = await waitResponse.json() as { status: string };
  expect(task.status).toBe(expectedStatus);
  return taskId;
}

function snapshotEnv(): Record<string, string | undefined> {
  return Object.fromEntries([
    'POSTHOG_KEY',
    'POSTHOG_HOST',
    'NO_PROXY',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'OD_MEDIA_ALLOW_STUBS',
  ].map((key) => [key, process.env[key]]));
}

function restoreEnv(env: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
