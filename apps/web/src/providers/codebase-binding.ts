import type {
  ProjectCodebaseBindingResponse,
  ProjectCodebaseBindingSelection,
  PutProjectCodebaseBindingRequest,
  WorkspaceCollabContext,
} from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';

export class CodebaseBindingError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'CodebaseBindingError';
  }
}

interface RequestOptions {
  workspaceContext?: WorkspaceCollabContext | null;
  signal?: AbortSignal;
  desktopImportToken?: string;
}

async function request<T>(
  projectId: string,
  method: 'GET' | 'PUT' | 'POST',
  options: RequestOptions,
  body?: PutProjectCodebaseBindingRequest,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.workspaceContext) Object.assign(headers, workspaceProjectHeaders(options.workspaceContext));
  if (body) headers['Content-Type'] = 'application/json';
  if (options.desktopImportToken) {
    headers['x-od-desktop-import-token'] = options.desktopImportToken;
  }
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/codebase-binding${method === 'POST' ? '/validate' : ''}`,
    {
      method,
      headers,
      cache: 'no-store',
      ...(options.signal ? { signal: options.signal } : {}),
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  if (!response.ok) {
    const data = await response.json().catch(() => null) as {
      error?: string | { message?: string; code?: string };
    } | null;
    const error = data?.error;
    throw new CodebaseBindingError(
      typeof error === 'string' ? error : error?.message ?? `Request failed (${response.status}).`,
      response.status,
      typeof error === 'object' ? error.code : undefined,
    );
  }
  return await response.json() as T;
}

export function fetchProjectCodebaseBinding(projectId: string, options: RequestOptions = {}) {
  return request<ProjectCodebaseBindingResponse>(projectId, 'GET', options);
}

export function validateProjectCodebaseBinding(
  projectId: string,
  body: PutProjectCodebaseBindingRequest,
  options: RequestOptions = {},
) {
  return request<ProjectCodebaseBindingSelection>(projectId, 'POST', options, body);
}

export function saveProjectCodebaseBinding(
  projectId: string,
  body: PutProjectCodebaseBindingRequest,
  options: RequestOptions = {},
) {
  return request<ProjectCodebaseBindingResponse>(projectId, 'PUT', options, body);
}

export const CODEBASE_BINDING_CHANGED_EVENT = 'open-design:codebase-binding-changed';
