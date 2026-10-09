import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import type { DesignWorkflowContext, ProjectContextDiscoveryResponse, WorkspaceDirectoryItem } from '@open-design/contracts';

const fixtureDirectory = vi.hoisted(() => ({ items: [] as WorkspaceDirectoryItem[] }));
vi.mock('../src/collab/vela-workspace-context.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/collab/vela-workspace-context.js')>();
  return { ...original, fetchVelaWorkspaceDirectory: vi.fn(async () => ({ ok: true, items: fixtureDirectory.items })) };
});

import { startServer, resetDesktopAuthForTests, type StartServerResult } from '../src/server.js';
import { ensureWorkspaceProject, getProject, insertProject, openDatabase } from '../src/db.js';
import { validateCodebaseBinding } from '../src/services/codebase-binding.js';
import { saveCodebaseBinding } from '../src/storage/codebase-binding.js';

it('wires real-server discovery through the fresh membership broker and persisted project authority', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'od-discovery-runtime-')));
  const source = path.join(root, 'source');
  await mkdir(path.join(source, 'apps/web/components'), { recursive: true });
  await writeFile(path.join(source, 'AGENTS.md'), 'DISCOVERY_RULE: keep edits in the existing coding session.');
  vi.stubEnv('OD_API_TOKEN', 'discovery-runtime-token');
  vi.stubEnv('OD_WORKSPACE_CONTEXT_SOURCE', 'vela');
  fixtureDirectory.items = [
    { workspaceId: 'runtime-personal', workspaceName: 'Runtime Personal', workspaceType: 'personal', workspaceMemberId: 'runtime-me', role: 'owner', memberStatus: 'active', lifecycleState: 'active' },
    { workspaceId: 'runtime-team', workspaceName: 'Runtime Team', workspaceType: 'team', workspaceMemberId: 'runtime-team-me', role: 'member', memberStatus: 'active', lifecycleState: 'active' },
  ];
  resetDesktopAuthForTests();
  let started: StartServerResult | undefined;
  try {
    started = await startServer({ port: 0, returnServer: true }) as StartServerResult;
    const dataRoot = await realpath(process.env.OD_DATA_DIR!);
    const db = openDatabase(root, { dataDir: dataRoot });
    const paths = { projectsRoot: path.join(dataRoot, 'projects'), runtimeDataRoot: dataRoot };
    for (const [id, workspace, creator] of [
      ['runtime-personal-project', fixtureDirectory.items[0]!, 'runtime-me'],
      ['runtime-private-other', fixtureDirectory.items[0]!, 'other-member'],
      ['runtime-team-project', fixtureDirectory.items[1]!, 'other-team-member'],
    ] as const) {
      insertProject(db, { id, name: id, metadata: { kind: 'prototype' }, createdAt: 1, updatedAt: 1 });
      ensureWorkspaceProject(db, { workspaceId: workspace.workspaceId, projectId: id, visibility: workspace.workspaceType,
        resourceState: 'active', createdByWorkspaceMemberId: creator });
      saveCodebaseBinding(db, id, null,
        await validateCodebaseBinding(getProject(db, id)!, paths, { sourceRoot: source, appRelativePath: 'apps/web' }));
    }
    const call = async (extra: Record<string, string> = {}) => {
      const response = await fetch(`${started!.url}/api/projects/source-context/discover`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer discovery-runtime-token' },
        body: JSON.stringify({ cwd: path.join(source, 'apps/web/components'), ...extra }),
      });
      return { status: response.status, body: await response.json() as ProjectContextDiscoveryResponse };
    };
    const result = await call();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: 'needs_selection', reason: 'ambiguous', selected: null,
      coverage: { scope: 'authorized_projects', scanTruncated: false } });
    expect(result.body.candidates.map((candidate) => candidate.projectId).sort()).toEqual(['runtime-personal-project', 'runtime-team-project']);
    expect(JSON.stringify(result.body)).not.toContain('runtime-private-other');
    const exact = await call({ workspaceId: 'runtime-team', workspaceMemberId: 'runtime-team-me' });
    expect(exact.body).toMatchObject({ status: 'ready', selected: { projectId: 'runtime-team-project',
      workspaceScope: { workspaceMemberId: 'runtime-team-me', workspaceName: 'Runtime Team' } } });
    const selected = (await call({ projectId: 'runtime-personal-project' })).body.selected!;
    expect(selected.projectId).toBe('runtime-personal-project');
    const apiHeaders = { 'content-type': 'application/json', authorization: 'Bearer discovery-runtime-token' };
    const uiSwitch = await fetch(`${started.url}/api/active`, {
      method: 'POST', headers: apiHeaders, body: JSON.stringify({ projectId: 'runtime-team-project' }),
    });
    expect(uiSwitch.status).toBe(200);
    expect((await call({ projectId: selected.projectId })).body.selected).toEqual(selected);
    const runsBefore = await (await fetch(`${started.url}/api/runs`, { headers: apiHeaders })).json();
    const preparedResponse = await fetch(`${started.url}/api/projects/${selected.projectId}/design-workflow/prepare`, {
      method: 'POST', headers: { ...apiHeaders, 'x-od-workspace-id': selected.workspaceScope!.workspaceId,
        'x-od-workspace-member-id': selected.workspaceScope!.workspaceMemberId },
      body: JSON.stringify({ projectId: selected.projectId, sourceRoot: selected.sourceRoot,
        appRelativePath: selected.appRelativePath, expectedBindingRevision: selected.bindingRevision,
        hostSessionId: 'discovery-native-session', requestId: 'discovery-prepare-1',
        prompt: 'Implement the change in this existing project.', capabilities: { imageContent: true, embeddedResources: true } }),
    });
    expect(preparedResponse.status, await preparedResponse.clone().text()).toBe(200);
    const prepared = await preparedResponse.json() as DesignWorkflowContext;
    expect(prepared).toMatchObject({ projectId: selected.projectId, executionOwner: 'host',
      sourceRoot: selected.sourceRoot, appRelativePath: selected.appRelativePath, bindingRevision: selected.bindingRevision });
    expect(prepared.guidance.find((section) => section.id === 'frozen-source-context')?.content).toContain('DISCOVERY_RULE');
    expect(await (await fetch(`${started.url}/api/runs`, { headers: apiHeaders })).json()).toEqual(runsBefore);
    expect(await readFile(path.join(source, 'AGENTS.md'), 'utf8')).toBe('DISCOVERY_RULE: keep edits in the existing coding session.');
    fixtureDirectory.items = fixtureDirectory.items.map((item) => ({ ...item, memberStatus: 'removed' }));
    expect((await call()).body.candidates).toEqual([]);
  } finally {
    if (started) {
      await started.shutdown();
      started.server.closeAllConnections();
      await new Promise<void>((resolve) => started!.server.close(() => resolve()));
    }
    resetDesktopAuthForTests();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
