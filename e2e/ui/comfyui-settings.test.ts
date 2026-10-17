import { expect, test } from '@/playwright/suite';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { openSettingsDialog } from '@/playwright/amr';
import { startComfyFixture, comfyGraph, comfyPng } from '@/comfyui-fixture';
import { T } from '@/timeouts';

test('[P1] ComfyUI settings persist a server and workflow and import a returned image into the origin project', async ({ page }, testInfo) => {
  test.setTimeout(T.xlong);
  const fixture = await startComfyFixture({ holdHistory: true });
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
    const panel = settings.getByRole('region', { name: 'ComfyUI', exact: true });
    await expect(panel).toBeVisible();
    const server = panel.getByRole('group', { name: 'Server', exact: true });
    await server.getByLabel('Name', { exact: true }).fill('Fixture GPU');
    await server.getByLabel('Server origin').fill(fixture.url);
    await server.getByLabel('Bearer token').fill('fixture-token-not-real');
    await server.getByLabel('I trust this exact server').check();
    const savedServer = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/api/media/comfyui/connections'));
    await server.getByRole('button', { name: 'Save server', exact: true }).click();
    expect((await savedServer).ok()).toBe(true);
    await expect(server.getByLabel('Bearer token')).toHaveValue('');
    await server.getByRole('button', { name: 'Test connection' }).click();
    await expect(panel.getByRole('status')).toContainText('Connection checked');
    const workflow = panel.getByRole('group', { name: 'Workflow', exact: true });
    await workflow.getByLabel('Name', { exact: true }).fill('Fixture render');
    await workflow.getByLabel('Import API JSON').setInputFiles({
      name: 'fixture-api.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(comfyGraph)),
    });
    await workflow.getByLabel('Positive prompt input').selectOption(JSON.stringify(['1', 'prompt']));
    await workflow.getByLabel('Final image output').selectOption('9');
    await workflow.getByLabel('I trust this graph').check();
    const savedWorkflow = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/api/media/comfyui/workflows'));
    await workflow.getByRole('button', { name: 'Save disabled workflow version' }).click();
    expect((await savedWorkflow).ok()).toBe(true);
    await panel.getByRole('button', { name: 'Validate schema', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('Schema checked');
    const enabled = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/enabled'));
    await panel.getByRole('button', { name: 'Enable', exact: true }).click();
    expect((await enabled).ok()).toBe(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const reopened = await openSettingsDialog(page);
    await reopened.getByRole('button', { name: 'Media providers', exact: true }).click();
    await reopened.getByLabel('ComfyUI manual-test destination project').selectOption(projectId);
    const current = reopened.getByRole('region', { name: 'ComfyUI', exact: true });
    await expect(current.getByText('Fixture GPU', { exact: false }).first()).toBeVisible();
    const testForm = current.getByRole('group', { name: 'Manual image test' });
    await testForm.getByRole('combobox', { name: 'Workflow', exact: true }).selectOption({ label: 'Fixture render · v1' });
    await testForm.getByLabel('Test prompt').fill('A ceramic cup');
    await expect(testForm.getByRole('button', { name: 'Run image test' })).toBeDisabled();
    await testForm.getByLabel('Submit a real generation').check();
    await expect(testForm.getByRole('button', { name: 'Run image test' })).toBeEnabled();
    await testForm.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('comfyui-settings.png') });
    const dispatched = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/api/projects/${projectId}/media/generate`));
    await testForm.getByRole('button', { name: 'Run image test' }).click();
    const accepted = await dispatched;
    expect(accepted.status()).toBe(202);
    const { taskId } = await accepted.json() as { taskId: string };
    await expect.poll(() => fixture.submissions.length).toBe(1);
    // Changing the destination for the next test must not move the in-flight image.
    await reopened.getByLabel('ComfyUI manual-test destination project').selectOption(otherProjectId);
    fixture.releaseHistory();
    await expect(reopened.getByRole('region', { name: 'ComfyUI', exact: true }).getByRole('img')).toHaveCount(0);
    await reopened.getByLabel('ComfyUI manual-test destination project').selectOption(projectId);
    const resultPanel = reopened.getByRole('region', { name: 'ComfyUI', exact: true });
    await expect(resultPanel.getByText('Imported into the originating project:', { exact: false })).toBeVisible({ timeout: T.long });
    expect(fixture.submissions).toHaveLength(1);
    expect(fixture.submissions[0]).toMatchObject({ prompt: { '1': { inputs: { prompt: 'A ceramic cup' } } } });
    const tasksResponse = await page.request.get(`/api/projects/${projectId}/media/tasks?includeDone=1`);
    const { tasks } = await tasksResponse.json() as { tasks: Array<{ taskId: string; file?: { name: string }; status: string }> };
    const task = tasks.find((entry) => entry.taskId === taskId);
    expect(task?.status).toBe('done');
    const bytes = await page.request.get(`/api/projects/${projectId}/raw/${task!.file!.name}`);
    expect(bytes.ok()).toBe(true);
    expect(await bytes.body()).toEqual(comfyPng);
    const otherFiles = await page.request.get(`/api/projects/${otherProjectId}/files`);
    expect(await otherFiles.text()).not.toContain(`comfy-${taskId}.png`);
    await resultPanel.getByRole('img').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('comfyui-imported.png') });
    const config = await page.request.get('/api/media/comfyui');
    expect(await config.text()).not.toContain('fixture-token-not-real');
  } finally { await fixture.close(); }
});
