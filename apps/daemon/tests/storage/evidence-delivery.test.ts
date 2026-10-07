import { writeAppConfig } from '../../src/app-config.js';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { enqueueObjectEvidence, evidenceStore, inheritFrozenAttachments, drainEvidence } from '../../src/services/evidence-delivery.js';
import type { ReportContext } from '../../src/langfuse-trace.js';

const context = (runId: string, projectId = 'project', conversationId = 'conversation'): ReportContext => ({
  projectId, conversationId, installationId: null, prefs: { metrics: true, content: true, artifactManifest: true },
  run: { runId, status: 'succeeded', startedAt: 1, endedAt: 2 },
  message: { messageId: runId, prompt: '', output: '' }, artifacts: [], eventsSummary: { toolCalls: 0, errors: 0, durationMs: 1 },
});
it('inherits frozen attachments only within the exact conversation and refuses ambiguous revisions', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'od-inherited-evidence-'));
  const entry = { identity: 'origin-message-identity', originMessageId: 'u1', source: 'user_upload' as const, source_path_hash: 'path-hash' };
  const target = { projectId: 'project', conversationId: 'conversation', runId: 'later-run' };
  const first = { objectClass: 'attachment' as const, id: 'att-first', filename: 'brief.txt', mime: 'text/plain', source: 'user_attachment', sourcePathHash: 'path-hash', body: Buffer.from('original bytes') };
  try {
    expect(await enqueueObjectEvidence(dir, context('empty'), [], 'strategy-task:empty')).toBe('not_required');
    expect((await evidenceStore(dir)).stats().jobs).toBe(0);
    await enqueueObjectEvidence(dir, context('first'), [first], 'strategy-task:first');
    first.body.fill(0);
    const inherited = await inheritFrozenAttachments(dir, target, [entry], []);
    expect(inherited[0]?.body?.toString()).toBe('original bytes');
    expect(inherited[0]?.id).not.toBe('att-first');
    expect(await inheritFrozenAttachments(dir, { ...target, conversationId: 'other' }, [entry], [])).toEqual([]);
    expect(await inheritFrozenAttachments(dir, { ...target, projectId: 'other' }, [entry], [])).toEqual([]);
    await enqueueObjectEvidence(dir, context('conflicting'), [{ ...first, body: Buffer.from('different revision') }], 'strategy-task:conflicting');
    expect(await inheritFrozenAttachments(dir, target, [entry], [])).toEqual([]);
  } finally { (await evidenceStore(dir)).close(); await rm(dir, { recursive: true, force: true }); }
});

it('keeps frozen object receipts local with a configured relay', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'od-local-task-receipts-'));
  vi.stubEnv('OPEN_DESIGN_TELEMETRY_RELAY_URL', 'https://telemetry.example.test/api/langfuse');
  vi.stubEnv('OPEN_DESIGN_OBJECT_OUTBOX_MODE', 'send');
  try {
    await writeAppConfig(dir, { telemetry: { metrics: true, content: true, artifactManifest: true } });
    const store = await evidenceStore(dir);
    await enqueueObjectEvidence(dir, context('request'), [
      { objectClass: 'artifact', id: 'request', filename: 'index.html', mime: 'text/html', source: 'run_artifact', body: Buffer.from('private artifact') },
    ], 'strategy-task:local');
    store.checkpointReceipt('object', 'run:request', { completeness: 'complete', artifactManifest: [] });
    const fetchImpl = vi.fn<typeof fetch>();
    await drainEvidence(dir, fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.inspect('object', 'run:request')?.status).not.toBe('uploaded');
  } finally {
    vi.unstubAllEnvs(); (await evidenceStore(dir)).close(); await rm(dir, { recursive: true, force: true });
  }
});
