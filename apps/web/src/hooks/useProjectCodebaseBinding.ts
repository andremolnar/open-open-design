import { useEffect, useState } from 'react';
import type { ProjectCodebaseBindingResponse, WorkspaceCollabContext } from '@open-design/contracts';
import { currentWorkspaceAccountGeneration } from '../collab/workspace-identity';
import { CODEBASE_BINDING_CHANGED_EVENT, fetchProjectCodebaseBinding } from '../providers/codebase-binding';

/** Status is always rechecked on project reopen, focus, and an explicit save. */
export function useProjectCodebaseBinding(
  projectId: string | null,
  workspaceContext?: WorkspaceCollabContext | null,
) {
  const accountGeneration = currentWorkspaceAccountGeneration();
  const [result, setResult] = useState<{
    projectId: string;
    accountGeneration: number;
    context: typeof workspaceContext;
    data: ProjectCodebaseBindingResponse;
  } | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let disposed = false;
    let controller: AbortController | null = null;
    const refresh = () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      void fetchProjectCodebaseBinding(projectId, { workspaceContext, signal: current.signal })
        .then((data) => {
          if (!disposed && !current.signal.aborted) setResult({ projectId, accountGeneration, context: workspaceContext, data });
        })
        .catch(() => {
          // Do not show an old "connected" indicator when freshness is unknown.
          if (!disposed && !current.signal.aborted) setResult(null);
        });
    };
    const onChange = (event: Event) => {
      if ((event as CustomEvent<{ projectId: string }>).detail?.projectId === projectId) refresh();
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener(CODEBASE_BINDING_CHANGED_EVENT, onChange);
    return () => {
      disposed = true;
      controller?.abort();
      window.removeEventListener('focus', refresh);
      window.removeEventListener(CODEBASE_BINDING_CHANGED_EVENT, onChange);
    };
  }, [projectId, workspaceContext, accountGeneration]);
  // The previous request's value must not flash in a newer project or account.
  return result?.projectId === projectId && result.context === workspaceContext
    && result.accountGeneration === accountGeneration ? result.data : null;
}
