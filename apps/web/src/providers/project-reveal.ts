import type { RevealProjectPathRequest, RevealProjectPathResponse, WorkspaceCollabContext } from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';

export async function revealProjectPath(
  projectId: string,
  body: RevealProjectPathRequest,
  workspaceContext?: WorkspaceCollabContext | null,
): Promise<RevealProjectPathResponse> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/reveal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(workspaceContext ? workspaceProjectHeaders(workspaceContext) : {}) },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(typeof data?.error === 'string' ? data.error : data?.error?.message ?? `Request failed (${response.status})`);
  }
  return await response.json() as RevealProjectPathResponse;
}
