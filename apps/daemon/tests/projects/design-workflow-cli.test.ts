import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildDesignWorkflowCliRequest, parseDesignWorkflowCliArgs, runDesignWorkflowCli, type DesignWorkflowCliFlags,
} from '../../src/projects/design-workflow-cli.js';

const identity = { projectId: 'project-a', workflowId: '681cb280-aa8a-4bc4-a2e4-1b6c1c3e4c76', hostSessionId: 'native-host-session' };
const digest = 'a'.repeat(64);
const prepare = {
  projectId: identity.projectId, sourceRoot: '/source/project with spaces', appRelativePath: 'apps/web',
  expectedBindingRevision: 4, hostSessionId: identity.hostSessionId, requestId: 'request-1', prompt: 'Refine the page',
  capabilities: { imageContent: true, embeddedResources: true },
};
const mutations = { ...identity, contextRevision: digest, expectedRevision: 1, requestId: 'request-2' };

describe('work-here CLI request boundary', () => {
  it.each([
    ['prepare', prepare, 'prepare'],
    ['status', identity, 'get'],
    ['asset', { ...identity, contextRevision: digest, assetId: 'image-1', representation: 'image', offset: 0, maxBytes: 32_768 }, 'asset'],
    ['checkpoint', { ...mutations, phase: 'critique', summary: 'Checked the result', checks: [] }, 'checkpoint'],
    ['register-artifact', { ...mutations, name: 'preview.html', sha256: digest }, 'register-artifact'],
    ['archive', { ...mutations, confirm: true }, 'archive'],
  ] as const)('uses the shared POST boundary for %s with exact identity', (command, body, endpoint) => {
    const request = buildDesignWorkflowCliRequest({ command, projectId: identity.projectId, request: body });
    expect(request.path).toBe(`/api/projects/project-a/design-workflow/${endpoint}`);
    expect(request.init.method).toBe('POST');
    expect(JSON.parse(String(request.init.body))).toEqual(body);
  });

  it('encodes the explicit project ID without resolving or trimming it', () => {
    const projectId = 'project/a b';
    expect(buildDesignWorkflowCliRequest({ command: 'status', projectId, request: { ...identity, projectId } }).path)
      .toBe('/api/projects/project%2Fa%20b/design-workflow/get');
  });

  it('rejects project mismatch, extra body keys, and invalid refresh revisions', () => {
    expect(() => buildDesignWorkflowCliRequest({ command: 'prepare', projectId: 'other', request: prepare })).toThrow(/exactly match/);
    expect(() => buildDesignWorkflowCliRequest({ command: 'prepare', projectId: 'project-a', request: { ...prepare, run: true } })).toThrow();
    expect(() => buildDesignWorkflowCliRequest({ command: 'prepare', projectId: 'project-a', request: { ...prepare, workflowId: identity.workflowId } })).toThrow(/required together/);
    expect(() => buildDesignWorkflowCliRequest({ command: 'checkpoint', projectId: 'project-a', request: { ...mutations, expectedRevision: 0, phase: 'completed', summary: 'Done' } })).toThrow();
    expect(() => buildDesignWorkflowCliRequest({ command: 'archive', projectId: 'project-a', request: { ...mutations, confirm: false } })).toThrow();
    expect(() => buildDesignWorkflowCliRequest({ command: 'archive', projectId: 'project-a', request: mutations })).toThrow();
    expect(() => buildDesignWorkflowCliRequest({ command: 'prepare', projectId: 'project-a', request: { ...prepare, workspaceId: 'team' } })).toThrow();
  });

  it('overrides prepare prompt and preserves long-form whitespace', () => {
    const prompt = 'First line\n\nSecond line\n';
    const request = buildDesignWorkflowCliRequest({ command: 'prepare', projectId: 'project-a', request: prepare, prompt });
    expect(JSON.parse(String(request.init.body)).prompt).toBe(prompt);
    expect(() => buildDesignWorkflowCliRequest({ command: 'status', projectId: 'project-a', request: identity, prompt })).toThrow(/only supported/);
    expect(() => buildDesignWorkflowCliRequest({ command: 'prepare', projectId: 'project-a', request: prepare, prompt: '' })).toThrow();
    expect(() => buildDesignWorkflowCliRequest({ command: 'prepare', projectId: 'project-a', request: prepare, prompt: 'x'.repeat(8_001) })).toThrow();
  });

  it('accepts request-file, prompt-file, JSON and the existing discovery options', () => {
    expect(parseDesignWorkflowCliArgs(['prepare', 'project-a', '--request-file=request.json', '--prompt-file', '-', '--json', '--daemon-url', 'http://localhost:1000', '--workspace', 'w', '--workspace-member', 'm']))
      .toEqual({ command: 'prepare', projectId: 'project-a', flags: { 'request-file': 'request.json', 'prompt-file': '-', json: true, 'daemon-url': 'http://localhost:1000', workspace: 'w', 'workspace-member': 'm' } });
  });

  it.each([
    ['prepare', '--request-file', 'request.json'],
    ['prepare', 'project-a', 'extra', '--request-file', 'request.json'],
    ['prepare', 'project-a', '--request-file', 'request.json', '--unknown'],
    ['prepare', 'project-a', '--request-file', '--json'],
    ['prepare', 'project-a', '--request-file', 'a', '--request-file', 'b'],
    ['prepare', 'project-a', '--request-file', 'a', '--json=false'],
    ['prepare', 'project-a', '--request-file', '-', '--prompt-file', '-'],
    ['status', 'project-a', '--request-file', 'a', '--prompt-file', 'b'],
    ['status', 'project-a', '--request-file', 'a', '--workspace', 'w'],
    ['status', 'project-a', '--request-file', 'a', '-x'],
    ['constructor', 'project-a', '--request-file', 'a'],
    ['status', 'project-a'],
  ])('rejects malformed argv %j', (...args) => {
    expect(() => parseDesignWorkflowCliArgs(args)).toThrow();
  });
});

describe('work-here CLI execution', () => {
  function dependencies(body: unknown) {
    return {
      readText: vi.fn((_path: string) => JSON.stringify(body)),
      request: vi.fn(async (_path: string, _init: RequestInit, _flags: DesignWorkflowCliFlags) => Response.json({ workflowId: identity.workflowId })),
      stdout: vi.fn((_text: string) => {}), stderr: vi.fn((_text: string) => {}),
    };
  }

  it('reads a JSON request from stdin and forwards discovery flags without a project lookup', async () => {
    const deps = dependencies(identity);
    expect(await runDesignWorkflowCli(['status', 'project-a', '--request-file', '-', '--json', '--workspace', 'w', '--workspace-member', 'm'], deps)).toBe(0);
    expect(deps.readText).toHaveBeenCalledExactlyOnceWith('-');
    expect(deps.request).toHaveBeenCalledExactlyOnceWith('/api/projects/project-a/design-workflow/get', { method: 'POST', body: JSON.stringify(identity) }, expect.objectContaining({ workspace: 'w', 'workspace-member': 'm' }));
    expect(JSON.parse(deps.stdout.mock.calls[0]![0])).toEqual({ workflowId: identity.workflowId });
    expect(deps.stderr).not.toHaveBeenCalled();
  });

  it('reads the prompt file only for prepare and overrides JSON before validation', async () => {
    const deps = dependencies(prepare);
    deps.readText.mockImplementation((path: string) => path === '-' ? 'Actual task\n' : JSON.stringify({ ...prepare, prompt: undefined }));
    expect(await runDesignWorkflowCli(['prepare', 'project-a', '--request-file', 'request.json', '--prompt-file', '-'], deps)).toBe(0);
    expect(JSON.parse(String(deps.request.mock.calls[0]![1].body)).prompt).toBe('Actual task\n');
  });

  it('reads actual request and prompt files with spaces without rewriting source data', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'od-work-here-cli-'));
    try {
      const requestPath = join(directory, 'request body.json');
      const promptPath = join(directory, 'design prompt.txt');
      writeFileSync(requestPath, JSON.stringify(prepare));
      writeFileSync(promptPath, 'Use the original image.\n\nKeep native components.\n');
      const { readText: _readText, ...deps } = dependencies(prepare);
      expect(await runDesignWorkflowCli(['prepare', 'project-a', '--request-file', requestPath, '--prompt-file', promptPath, '--json'], deps)).toBe(0);
      expect(JSON.parse(String(deps.request.mock.calls[0]![1].body))).toEqual({ ...prepare, prompt: 'Use the original image.\n\nKeep native components.\n' });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects invalid JSON and mismatched projects before network or daemon discovery', async () => {
    const deps = dependencies({ ...prepare, projectId: 'other' });
    expect(await runDesignWorkflowCli(['prepare', 'project-a', '--request-file', 'request.json'], deps)).toBe(2);
    deps.readText.mockReturnValue('{invalid');
    expect(await runDesignWorkflowCli(['prepare', 'project-a', '--request-file', 'request.json'], deps)).toBe(2);
    expect(deps.request).not.toHaveBeenCalled();
    expect(deps.stdout).not.toHaveBeenCalled();
    expect(JSON.parse(deps.stderr.mock.calls[0]![0]).error.code).toBe('invalid-request');
  });

  it('preserves daemon conflict details and exits unsuccessfully', async () => {
    const deps = dependencies(identity);
    const error = { error: { code: 'stale_binding', message: 'Review the current binding' } };
    deps.request.mockResolvedValue(Response.json(error, { status: 409 }));
    expect(await runDesignWorkflowCli(['status', 'project-a', '--request-file', '-'], deps)).toBe(1);
    expect(JSON.parse(deps.stderr.mock.calls[0]![0])).toEqual(error);
    expect(deps.stdout).not.toHaveBeenCalled();
  });

  it('preserves exact binary asset envelopes as machine-readable JSON', async () => {
    const asset = { ...identity, contextRevision: digest, assetId: 'image-1', representation: 'original' };
    const deps = dependencies(asset);
    const bytes = { base64: 'AP9QTkcA', offset: 0, totalBytes: 6, eof: true };
    deps.request.mockResolvedValue(Response.json(bytes));
    expect(await runDesignWorkflowCli(['asset', 'project-a', '--request-file', '-', '--json'], deps)).toBe(0);
    expect(JSON.parse(deps.stdout.mock.calls[0]![0])).toEqual(bytes);
  });

  it('reports a transport failure without claiming success', async () => {
    const deps = dependencies(identity);
    deps.request.mockRejectedValue(new Error('Connection refused'));
    expect(await runDesignWorkflowCli(['status', 'project-a', '--request-file', '-'], deps)).toBe(1);
    expect(JSON.parse(deps.stderr.mock.calls[0]![0]).error).toEqual({ code: 'daemon-request-failed', message: 'Connection refused' });
    expect(deps.stdout).not.toHaveBeenCalled();
  });
});
