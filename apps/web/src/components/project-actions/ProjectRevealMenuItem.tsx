import { useEffect, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { currentWorkspaceAccountGeneration, workspaceIdentityCacheKey } from '../../collab/workspace-identity';
import { useT } from '../../i18n';
import { fetchAppVersionInfo } from '../../providers/registry';
import { revealProjectPath } from '../../providers/project-reveal';
import { Icon } from '../Icon';
import styles from './ProjectRevealMenuItem.module.css';

/** One native-folder action shared by project cards, recent rows, and the
 * in-project switcher. Failures stay in the originating menu for retry. */
export function ProjectRevealMenuItem({ projectId, workspaceContext, disabled = false, onRevealed }: {
  projectId: string;
  workspaceContext?: WorkspaceCollabContext | null;
  disabled?: boolean;
  onRevealed: () => void;
}) {
  const t = useT();
  const [platform, setPlatform] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ scope: string; message: string } | null>(null);
  const scope = JSON.stringify([currentWorkspaceAccountGeneration(), workspaceIdentityCacheKey(workspaceContext), projectId]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const mountedRef = useRef(false);
  const requestRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    requestRef.current++;
    busyRef.current = false;
    setBusy(false);
    setError(null);
    return () => { mountedRef.current = false; requestRef.current++; };
  }, [scope]);
  useEffect(() => {
    let active = true;
    void fetchAppVersionInfo().then((info) => {
      if (active) setPlatform(info?.platform ?? 'unknown');
    }).catch(() => { if (active) setPlatform('unknown'); });
    return () => { active = false; };
  }, []);

  async function reveal() {
    if (disabled || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const request = ++requestRef.current;
    const current = () => mountedRef.current && scopeRef.current === scope && requestRef.current === request;
    try {
      await revealProjectPath(projectId, {}, workspaceContext ?? null);
      if (current()) onRevealed();
    } catch (failure) {
      if (current()) setError({ scope, message: failure instanceof Error ? failure.message : String(failure) });
    } finally {
      if (current()) { busyRef.current = false; setBusy(false); }
    }
  }

  return <>
    <Button role="menuitem" disabled={disabled || busy} aria-busy={busy}
      title={disabled ? t('recentProjects.ownOnlyMutation') : undefined}
      onClick={(event) => { event.stopPropagation(); void reveal(); }}>
      <Icon name={busy ? 'spinner' : 'folder-2'} size={14} />
      <span>{t(platform === 'darwin' ? 'designFiles.revealInFinder'
        : platform === 'win32' ? 'designFiles.revealInExplorer' : 'designFiles.revealInFileManager')}</span>
    </Button>
    {error?.scope === scope ? <div className={styles.error} role="alert">
      {t('designFiles.revealFailed')} {error.message}
    </div> : null}
  </>;
}
