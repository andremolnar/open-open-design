// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../src/i18n';
import { ComfySettings, ComfySettingsPanel } from '../../src/components/ComfySettings';
import { suggestComfyBuilder } from '../../src/components/ComfyWorkflowBuilder';
import type { ComfySettingsResponse } from '@open-design/contracts';

const settings = { connections: [{ id: 'server', name: 'Studio GPU', baseUrl: 'http://127.0.0.1:8188', trustedNetwork: true, hasToken: true }],
  workflows: [{ id: 'workflow', version: 1, name: 'Cup render', connectionId: 'server', graphSha256: 'hash', enabled: true, schemaCheckedAt: 1 }] };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mockRequests(configuration: ComfySettingsResponse = settings) {
  const writes: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      writes.push({ url, body: JSON.parse(String(init.body)) });
      if (url.endsWith('/media/generate')) return Response.json({ taskId: 'job', status: 'running', startedAt: 1 });
      return Response.json({ id: 'new-server' });
    }
    if (url === '/api/media/comfyui') return Response.json(configuration);
    if (url.endsWith('/workspace-scope')) return Response.json({ scope: { kind: 'unbound',
      projectId: url.split('/')[3], workspaceId: null, context: null } });
    if (url.includes('/media/tasks')) return Response.json({ tasks: writes.some((write) => write.url.endsWith('/media/generate'))
      ? [{ taskId: 'job', model: 'comfyui/workflow@1', status: 'done', startedAt: 1, endedAt: 2, elapsed: 1, progress: [], progressCount: 0,
        file: { name: 'comfy-job.png' } }] : [] });
    throw new Error(`Unexpected URL ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { writes, fetchMock };
}

describe('ComfyUI settings manual test', () => {
  it('preserves unsaved authoring fields and trust when choosing the result destination', async () => {
    mockRequests();
    render(<I18nProvider initial="en"><ComfySettings projects={[{ id: 'A', name: 'Project A', workspaceId: null }]} workspaceContext={null} /></I18nProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Configure ComfyUI' }));
    const form = () => within(screen.getByRole('group', { name: 'Workflow' }));
    fireEvent.change(form().getByLabelText('Name', { exact: true }), { target: { value: 'Unsaved render' } });
    const json = JSON.stringify({ '6': { class_type: 'CLIPTextEncode', inputs: { text: 'cup' } },
      '5': { class_type: 'PreviewImage', inputs: { images: ['6', 0] } } });
    fireEvent.change(form().getByLabelText('Paste API graph or /prompt request JSON'), { target: { value: json } });
    fireEvent.click(form().getByRole('button', { name: 'Build input form' }));
    await waitFor(() => expect(form().getByLabelText('Source · 6.text')).toBeTruthy());
    fireEvent.click(form().getByLabelText(/I trust this graph/));
    fireEvent.change(screen.getByLabelText('ComfyUI manual-test destination project'), { target: { value: 'A' } });
    await waitFor(() => expect((form().getByLabelText('Name', { exact: true }) as HTMLInputElement).value).toBe('Unsaved render'));
    expect((form().getByLabelText('Paste API graph or /prompt request JSON') as HTMLTextAreaElement).value).toBe(json);
    expect((form().getByLabelText(/I trust this graph/) as HTMLInputElement).checked).toBe(true);
    expect((form().getByLabelText('Final image output to import') as HTMLSelectElement).value).toBe('5');
  });

  it('does not guess between multiple prompt encoders or outputs', () => {
    const suggestion = suggestComfyBuilder({
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'positive' } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'negative' } },
      '5': { class_type: 'PreviewImage', inputs: { images: ['6', 0] } },
      '9': { class_type: 'SaveImage', inputs: { images: ['6', 0] } },
    });
    expect(suggestion.builder.promptTargets).toEqual([]);
    expect(suggestion.output).toBe('');
  });
  it('keeps Save actionable and explains missing mappings instead of silently disabling it', async () => {
    const { writes } = mockRequests();
    render(<I18nProvider initial="en"><ComfySettingsPanel projectId={null} ready={false} workspaceContext={null} /></I18nProvider>);
    const form = within(screen.getByRole('group', { name: 'Workflow' }));
    const save = form.getByRole('button', { name: 'Save disabled workflow version' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect((await screen.findByRole('alert')).textContent).toMatch(/import or paste/i);
    expect(writes).toHaveLength(0);
  });

  it('populates the JSON editor from a file and suggests a unique prompt/output without enabling a GPU job', async () => {
    mockRequests();
    render(<I18nProvider initial="en"><ComfySettingsPanel projectId={null} ready={false} workspaceContext={null} /></I18nProvider>);
    const form = within(screen.getByRole('group', { name: 'Workflow' }));
    const json = JSON.stringify({ prompt: {
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'YOUR PROMPT HERE' } },
      '5': { class_type: 'PreviewImage', inputs: { images: ['6', 0] } },
    } });
    const file = new File([json], 'sample-workflow.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => json });
    fireEvent.change(form.getByLabelText('Import API JSON'), { target: { files: [file] } });
    await waitFor(() => expect((form.getByLabelText('Paste API graph or /prompt request JSON') as HTMLTextAreaElement).value).toBe(json));
    expect((form.getByLabelText('Name', { exact: true }) as HTMLInputElement).value).toBe('sample-workflow');
    expect((form.getByLabelText('Source · 6.text') as HTMLSelectElement).value).toBe('prompt');
    expect((form.getByLabelText('Final image output to import') as HTMLSelectElement).value).toBe('5');
    expect((screen.getByRole('button', { name: 'Run image test' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('renders typed public inputs for the selected version and sends them as workflowInputs', async () => {
    const { writes } = mockRequests({ ...settings, workflows: [{ ...settings.workflows[0]!, parameters: [
      { name: 'seed', type: 'number', defaultValue: 123 }, { name: 'enabled', type: 'boolean', defaultValue: true },
    ] }] });
    render(<I18nProvider initial="en"><ComfySettingsPanel projectId="origin-A" ready workspaceContext={null} /></I18nProvider>);
    const form = within(screen.getByRole('group', { name: 'Manual image test' }));
    await waitFor(() => expect(form.getByRole('option', { name: 'Cup render · v1' })).toBeTruthy());
    fireEvent.change(form.getByLabelText('Workflow'), { target: { value: 'comfyui/workflow@1' } });
    fireEvent.change(form.getByLabelText('Test prompt'), { target: { value: 'a cup' } });
    fireEvent.change(form.getByLabelText('seed'), { target: { value: '456' } });
    fireEvent.click(form.getByLabelText('enabled'));
    fireEvent.click(form.getByLabelText(/Submit a real generation/));
    fireEvent.click(form.getByRole('button', { name: 'Run image test' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.body.workflowInputs).toEqual({ seed: 456, enabled: false });
  });
  it('builds a form from an envelope, locks dimensions and saves explicit prompt, parameter and PreviewImage mappings', async () => {
    const { writes } = mockRequests();
    render(<I18nProvider initial="en"><ComfySettingsPanel projectId={null} ready={false} workspaceContext={null} /></I18nProvider>);
    const form = within(screen.getByRole('group', { name: 'Workflow' }));
    const graph = {
      '21': { class_type: 'CLIPTextEncode', inputs: { text: 'Example prompt' } },
      '20': { class_type: 'FixtureDimensions', inputs: { width: 512, height: 512, preset: 'standard' } },
      '30': { class_type: 'PreviewImage', inputs: { images: ['21', 0] } },
    };
    fireEvent.change(form.getByLabelText('Paste API graph or /prompt request JSON'), { target: { value: JSON.stringify({ prompt: graph }) } });
    fireEvent.click(form.getByRole('button', { name: 'Build input form' }));
    await waitFor(() => expect(form.getByLabelText('Source · 21.text')).toBeTruthy());
    fireEvent.change(form.getByLabelText('Name', { exact: true }), { target: { value: 'Sample workflow' } });
    fireEvent.change(form.getByLabelText('Locked value · 20.width'), { target: { value: '640' } });
    fireEvent.change(form.getByLabelText('Locked value · 20.height'), { target: { value: '480' } });
    fireEvent.change(form.getByLabelText('Source · 21.text'), { target: { value: 'prompt' } });
    fireEvent.change(form.getByLabelText('Source · 20.preset'), { target: { value: 'parameter' } });
    fireEvent.change(form.getByLabelText('Request input name · 20.preset'), { target: { value: 'preset' } });
    fireEvent.change(form.getByLabelText('Final image output to import'), { target: { value: '30' } });
    fireEvent.click(form.getByLabelText(/I trust this graph/));
    fireEvent.click(form.getByRole('button', { name: 'Save disabled workflow version' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ url: '/api/media/comfyui/workflows', body: {
      name: 'Sample workflow', promptTargets: [{ nodeId: '21', input: 'text' }],
      parameters: [{ name: 'preset', nodeId: '20', input: 'preset' }], output: { nodeId: '30', index: 0 },
      graph: { ...graph, '20': { ...graph['20'], inputs: { width: 640, height: 480, preset: 'standard' } } },
    } });
    expect(form.queryByLabelText('Source · 30.images')).toBeNull();
  });
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
