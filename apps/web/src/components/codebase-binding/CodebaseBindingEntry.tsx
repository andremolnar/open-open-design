import { Button } from '@open-design/components';
import type { ProjectCodebaseBindingResponse, WorkspaceCollabContext } from '@open-design/contracts';
import { useT } from '../../i18n';
import { useProjectCodebaseBinding } from '../../hooks/useProjectCodebaseBinding';
import { Icon } from '../Icon';
import styles from './CodebaseBindingDialog.module.css';

export function CodebaseBindingMenuItem({ projectId, workspaceContext, ownedBySelf, onOpen }: {
  projectId: string;
  workspaceContext?: WorkspaceCollabContext | null;
  ownedBySelf: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  const status = useProjectCodebaseBinding(projectId, workspaceContext);
  const unavailable = status?.capabilities?.canBind === false;
  return (
    <Button
      role="menuitem"
      disabled={!ownedBySelf || unavailable}
      title={!ownedBySelf ? t('codebaseBinding.permissionDenied') : unavailable ? t('codebaseBinding.unsupported') : undefined}
      onClick={onOpen}
      data-testid="workspace-tabs-connect-codebase"
    >
      <Icon name="folder-2" size={14} />
      <span>{t(status?.binding ? 'codebaseBinding.manageAction' : 'codebaseBinding.connectAction')}</span>
    </Button>
  );
}

export function CodebaseBindingIndicator({ status, disabled, onOpen }: {
  status: ProjectCodebaseBindingResponse | null;
  disabled: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  if (!status?.binding) return null;
  const connected = status.status === 'connected';
  const label = t(connected ? 'codebaseBinding.connected' : 'codebaseBinding.unavailable');
  return (
    <Button
      variant="ghost"
      size="sm"
      className={`${styles.indicator}${connected ? '' : ` ${styles.warning}`}`}
      aria-label={label}
      title={label}
      onClick={onOpen}
      disabled={disabled}
      data-testid="codebase-binding-indicator"
    >
      <Icon name="folder-2" size={14} />
      {!connected ? <span aria-hidden>!</span> : null}
    </Button>
  );
}
