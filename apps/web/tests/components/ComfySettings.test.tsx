// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../src/i18n';
import { ComfySettingsPanel } from '../../src/components/ComfySettings';

const settings = { connections: [{ id: 'server', name: 'Studio GPU', baseUrl: 'http://127.0.0.1:8188', trustedNetwork: true, hasToken: true }],
  workflows: [{ id: 'workflow', version: 1, name: 'Cup render', connectionId: 'server', graphSha256: 'hash', enabled: true, schemaCheckedAt: 1 }] };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mockRequests() {
  const writes: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      writes.push({ url, body: JSON.parse(String(init.body)) });
      if (url.endsWith('/media/generate')) return Response.json({ taskId: 'job', status: 'running', startedAt: 1 });
      return Response.json({ id: 'new-server' });
    }
    if (url === '/api/media/comfyui') return Response.json(settings);
    if (url.includes('/media/tasks')) return Response.json({ tasks: writes.some((write) => write.url.endsWith('/media/generate'))
      ? [{ taskId: 'job', model: 'comfyui/workflow@1', status: 'done', startedAt: 1, endedAt: 2, elapsed: 1, progress: [], progressCount: 0,
        file: { name: 'comfy-job.png' } }] : [] });
    throw new Error(`Unexpected URL ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { writes, fetchMock };
}

describe('ComfyUI settings manual test', () => {
  it('saves a write-only token without returning it to the input or putting it into localStorage', async () => {
    const { writes } = mockRequests();
    render(<I18nProvider initial="en"><ComfySettingsPanel projectId={null} ready={false} workspaceContext={null} /></I18nProvider>);
    const server = within(screen.getByRole('group', { name: 'Server' }));
    fireEvent.change(server.getByLabelText('Name', { exact: true }), { target: { value: 'My GPU' } });
    fireEvent.change(server.getByLabelText('Bearer token (optional, write-only)'), { target: { value: 'private-token' } });
    fireEvent.click(server.getByRole('checkbox'));
    fireEvent.click(server.getByRole('button', { name: 'Save server' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ url: '/api/media/comfyui/connections', body: { name: 'My GPU', token: 'private-token', trustedNetwork: true } });
    await waitFor(() => expect((server.getByLabelText('Bearer token (optional, write-only)') as HTMLInputElement).value).toBe(''));
    expect(JSON.stringify(localStorage)).not.toContain('private-token');
  });

  it('requires confirmation and sends a versioned workflow to the origin project, then previews imported bytes', async () => {
    const { writes } = mockRequests();
    render(<I18nProvider initial="en"><ComfySettingsPanel projectId="origin-A" ready workspaceContext={null} /></I18nProvider>);
    const form = within(screen.getByRole('group', { name: 'Manual image test' }));
    await waitFor(() => expect(form.getByRole('option', { name: 'Cup render · v1' })).toBeTruthy());
    fireEvent.change(form.getByLabelText('Workflow'), { target: { value: 'comfyui/workflow@1' } });
    fireEvent.change(form.getByLabelText('Test prompt'), { target: { value: 'A ceramic cup' } });
    expect((form.getByRole('button', { name: 'Run image test' }) as HTMLButtonElement).disabled).toBe(true);
    expect(writes).toHaveLength(0);
    fireEvent.click(form.getByRole('checkbox'));
    fireEvent.click(form.getByRole('button', { name: 'Run image test' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ url: '/api/projects/origin-A/media/generate', body: {
      surface: 'image', model: 'comfyui/workflow@1', prompt: 'A ceramic cup', requestId: expect.any(String),
    } });
    await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toContain('/api/projects/origin-A/raw/comfy-job.png'));
  });

  it('does not enable a run from Home or while project authority is unavailable', async () => {
    const { writes } = mockRequests();
    render(<I18nProvider initial="en"><ComfySettingsPanel projectId={null} ready={false} workspaceContext={null} /></I18nProvider>);
    expect(screen.getByText(/Choose a destination project above/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Run image test' }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(screen.getByText('Cup render · v1', { selector: 'strong' })).toBeTruthy());
    expect(writes).toHaveLength(0);
  });
});
