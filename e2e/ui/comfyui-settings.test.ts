import { expect, test } from '@/playwright/suite';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { openSettingsDialog } from '@/playwright/amr';
import { startComfyFixture, comfyGraph, comfyPng } from '@/comfyui-fixture';
import { T } from '@/timeouts';

test('[P1] ComfyUI provider settings persist reusable workflows and a selected server imports into the origin project', async ({ page }, testInfo) => {
  test.setTimeout(T.xlong);
  const fixture = await startComfyFixture({ holdHistory: true });
  const alternate = await startComfyFixture({ holdHistory: true });
  try {
    await applyStandardMocks(page);
    const projectId = `comfy-${Date.now()}`;
    const created = await page.request.post('/api/projects', { data: {
      id: projectId, name: 'ComfyUI manual-test fixture', skillId: null, designSystemId: null,
    } });
    expect(created.ok(), await created.text()).toBe(true);
    const { conversationId } = await created.json() as { conversationId: string };
    const otherProjectId = `${projectId}-other`;
    expect((await page.request.post('/api/projects', { data: { id: otherProjectId, name: 'Other project', skillId: null, designSystemId: null } })).ok()).toBe(true);
    await page.goto(`/projects/${projectId}/conversations/${conversationId}`, { waitUntil: 'domcontentloaded' });
    const settings = await openSettingsDialog(page);
    await settings.getByRole('button', { name: 'Media providers', exact: true }).click();
    await expect(settings.getByRole('region', { name: 'ComfyUI', exact: true })).toHaveCount(0);
    await settings.getByRole('tab', { name: /ComfyUI/ }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('comfyui-entry.png') });
    await settings.getByRole('tab', { name: /ComfyUI/ }).click();
    const panel = settings.getByRole('region', { name: 'ComfyUI', exact: true });
    await expect(panel).toBeVisible();
    await expect(settings.getByLabel('ComfyUI manual-test destination project')).toHaveCount(0);
    await expect(settings.getByRole('group', { name: 'Manual image test' })).toHaveCount(0);
    const badAlias = await page.request.post(`/api/projects/${projectId}/media/generate`, { data: {
      surface: 'image', model: 'comfyui', prompt: 'Do not submit this provider alias',
    } });
    expect(badAlias.status()).toBe(400);
    expect((await badAlias.json()).error).toMatchObject({ code: 'COMFY_INVALID', message: expect.stringContaining('Save and enable') });
    expect(fixture.submissions).toHaveLength(0);
    await panel.getByRole('button', { name: 'Add server' }).click();
    let server = panel.getByRole('group', { name: 'Server', exact: true });
    await server.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('comfyui-add-server.png') });
    await server.getByLabel('Name', { exact: true }).fill('Fixture GPU');
    await server.getByLabel('Server origin').fill(fixture.url);
    await server.getByLabel('Bearer token').fill('fixture-token-not-real');
    await server.getByLabel('I trust this exact server').check();
    const savedServer = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/api/media/comfyui/connections'));
    await server.getByRole('button', { name: 'Save server', exact: true }).click();
    const firstResponse = await savedServer;
    expect(firstResponse.ok()).toBe(true);
    const firstServer = await firstResponse.json() as { id: string };
    await expect(panel.getByLabel('Bearer token')).toHaveCount(0);
    const active = panel.getByRole('group', { name: 'Active servers' });
    await active.getByRole('button', { name: 'Test connection' }).click();
    await expect(active.getByRole('status')).toContainText('Connection checked');
    await panel.getByRole('button', { name: 'Add server' }).click();
    server = panel.getByRole('group', { name: 'Server', exact: true });
    await server.getByLabel('Name', { exact: true }).fill('Alternate fixture GPU');
    await server.getByLabel('Server origin').fill(alternate.url);
    await server.getByLabel('I trust this exact server').check();
    const savedAlternate = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/api/media/comfyui/connections'));
    await server.getByRole('button', { name: 'Save server', exact: true }).click();
    const alternateResponse = await savedAlternate;
    expect(alternateResponse.ok()).toBe(true);
    const alternateServer = await alternateResponse.json() as { id: string };
    const workflow = panel.getByRole('group', { name: 'Workflow', exact: true });
    await workflow.getByLabel('Preferred server').selectOption(firstServer.id);
    await expect(workflow.getByRole('button', { name: 'Save disabled workflow version' })).toBeEnabled();
    await workflow.getByRole('button', { name: 'Save disabled workflow version' }).click();
    await expect(panel.getByRole('alert')).toContainText('Import or paste');
    await workflow.getByLabel('Name', { exact: true }).fill('Fixture render');
    const importedJson = JSON.stringify({ prompt: comfyGraph });
    await workflow.getByLabel('Import API JSON').setInputFiles({ name: 'fixture-api.json', mimeType: 'application/json', buffer: Buffer.from(importedJson) });
    await expect(workflow.getByLabel('Paste API graph or /prompt request JSON')).toHaveValue(importedJson);
    await workflow.getByRole('combobox', { name: 'Source · 1.prompt', exact: true }).selectOption('prompt');
    await workflow.getByLabel('Locked value · 20.width', { exact: true }).fill('640');
    await workflow.getByLabel('Locked value · 20.height', { exact: true }).fill('480');
    await workflow.getByRole('combobox', { name: 'Source · 1.seed', exact: true }).selectOption('parameter');
    await workflow.getByLabel('Request input name · 1.seed', { exact: true }).fill('seed');
    await workflow.getByLabel('Final image output').selectOption('5');
    await workflow.getByLabel('I trust this graph').check();
    await expect(workflow.getByLabel('Name', { exact: true })).toHaveValue('Fixture render');
    await expect(workflow.getByLabel('Locked value · 20.width', { exact: true })).toHaveValue('640');
    await expect(workflow.getByLabel('I trust this graph')).toBeChecked();
    await workflow.getByRole('button', { name: 'Build input form', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('comfyui-builder.png') });
    const savedWorkflow = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/api/media/comfyui/workflows'));
    await workflow.getByRole('button', { name: 'Save disabled workflow version' }).click();
    const savedResponse = await savedWorkflow;
    expect(savedResponse.ok()).toBe(true);
    const savedVersion = await savedResponse.json() as { id: string; version: number };
    const modelId = `comfyui/${savedVersion.id}@${savedVersion.version}`;
    const enabled = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/enabled'));
    await panel.getByRole('button', { name: 'Enable', exact: true }).click();
    expect((await enabled).ok()).toBe(true);
    const catalog = await (await page.request.get('/api/media/models')).json() as { image: Array<{ id: string; workflowInputs?: unknown }> };
    expect(catalog.image.find((model) => model.id === modelId)).toMatchObject({ workflowInputs: [{ name: 'seed', type: 'number', required: true }] });
    expect(catalog.image.some((model) => model.id === 'comfyui')).toBe(false);
    const discovery = await (await page.request.get('/api/media/models')).json();
    expect(discovery.comfyui.workflows).toContainEqual(expect.objectContaining({ name: 'Fixture render', preferredServerId: firstServer.id,
      model: modelId, inputs: [{ name: 'seed', type: 'number', required: true }] }));
    expect(discovery.comfyui.servers).toContainEqual({ id: alternateServer.id, name: 'Alternate fixture GPU' });
    for (const secret of [fixture.url, alternate.url, 'fixture-token-not-real', 'graph', 'defaultValue']) expect(JSON.stringify(discovery.comfyui)).not.toContain(secret);
    const enabledAlias = await page.request.post(`/api/projects/${projectId}/media/generate`, { data: { surface: 'image', model: 'comfyui', prompt: 'Do not auto-select a workflow' } });
    expect(enabledAlias.status()).toBe(400);
    expect((await enabledAlias.json()).error.message).toContain(modelId);
    for (const overrides of [{ aspect: '16:9' }, { quality: 'high' }, { resolution: '2K' },
      { image: 'reference.png' }, { images: ['reference.png'] }, { output: 'custom.png' }]) {
      const rejected = await page.request.post(`/api/projects/${projectId}/media/generate`, { data: {
        surface: 'image', model: modelId, prompt: 'A ceramic cup', workflowInputs: { seed: 456 },
        requestId: `${projectId}-rejected-options`, ...overrides,
      } });
      expect(rejected.status()).toBe(400);
      expect((await rejected.json()).error).toMatchObject({ code: 'COMFY_UNSUPPORTED_OPTIONS', nextStep: 'revise-options', retryable: false });
    }
    const beforeGeneration = await page.request.get(`/api/projects/${projectId}/media/tasks?includeDone=1`);
    expect((await beforeGeneration.json()).tasks).toHaveLength(0);
    expect(fixture.submissions).toHaveLength(0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const reopened = await openSettingsDialog(page);
    await reopened.getByRole('button', { name: 'Media providers', exact: true }).click();
    await reopened.getByRole('tab', { name: /ComfyUI/ }).click();
    const current = reopened.getByRole('region', { name: 'ComfyUI', exact: true });
    await expect(current.getByText('Fixture GPU', { exact: false }).first()).toBeVisible();
    await expect(current.getByRole('group', { name: 'Active servers' }).getByRole('article')).toHaveCount(2);
    await current.getByRole('group', { name: 'Active servers' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('comfyui-settings.png') });
    const accepted = await page.request.post(`/api/projects/${projectId}/media/generate`, { data: {
      surface: 'image', model: modelId, prompt: 'A ceramic cup', workflowInputs: { seed: 456 },
      comfyServerId: alternateServer.id, requestId: `${projectId}-selected-server`,
    } });
    expect(accepted.status()).toBe(202);
    const { taskId } = await accepted.json() as { taskId: string };
    await expect.poll(() => alternate.submissions.length).toBe(1);
    expect(fixture.submissions).toHaveLength(0);
    alternate.releaseHistory();
    await expect.poll(async () => {
      const response = await page.request.get(`/api/projects/${projectId}/media/tasks?includeDone=1`);
      return (await response.json()).tasks.find((task: { taskId: string }) => task.taskId === taskId)?.status;
    }, { timeout: T.long }).toBe('done');
    expect(alternate.submissions).toHaveLength(1);
    expect(alternate.submissions[0]).toMatchObject({ prompt: { '1': { inputs: { prompt: 'A ceramic cup' } } } });
    expect(alternate.submissions[0]).toMatchObject({ prompt: {
      '1': { inputs: { seed: 456, width: ['20', 0], height: ['20', 1] } },
      '20': { inputs: { width: 640, height: 480, preset: 'standard' } },
    } });
    const tasksResponse = await page.request.get(`/api/projects/${projectId}/media/tasks?includeDone=1`);
    const { tasks } = await tasksResponse.json() as { tasks: Array<{ taskId: string; file?: { name: string }; status: string }> };
    const task = tasks.find((entry) => entry.taskId === taskId);
    expect(task?.status).toBe('done');
    const bytes = await page.request.get(`/api/projects/${projectId}/raw/${task!.file!.name}`);
    expect(bytes.ok()).toBe(true);
    expect(await bytes.body()).toEqual(comfyPng);
    const otherFiles = await page.request.get(`/api/projects/${otherProjectId}/files`);
    expect(await otherFiles.text()).not.toContain(`comfy-${taskId}.png`);
    const config = await page.request.get('/api/media/comfyui');
    expect(await config.text()).not.toContain('fixture-token-not-real');
    await current.getByRole('button', { name: 'Edit as new version', exact: true }).click();
    const edited = current.getByRole('group', { name: 'Workflow', exact: true });
    await expect(edited.getByLabel('Preferred server')).toHaveValue(firstServer.id);
    await expect(edited.getByLabel('Locked value · 20.width', { exact: true })).toHaveValue('640');
    await expect(edited.getByRole('combobox', { name: 'Source · 1.prompt', exact: true })).toHaveValue('prompt');
    await expect(edited.getByLabel('Request input name · 1.seed', { exact: true })).toHaveValue('seed');
    await expect(edited.getByLabel('Final image output')).toHaveValue('5');
  } finally { await alternate.close(); await fixture.close(); }
});
