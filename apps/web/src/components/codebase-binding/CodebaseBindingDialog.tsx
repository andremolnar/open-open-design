import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  Button, Dialog, DialogDescription, DialogFooter, DialogTitle, Input,
} from '@open-design/components';
import { isOpenDesignHostAvailable, pickHostWorkingDir } from '@open-design/host';
import type {
  ProjectCodebaseBindingResponse,
  ProjectCodebaseBindingSelection,
  WorkspaceCollabContext,
} from '@open-design/contracts';
import { useT } from '../../i18n';
import { currentWorkspaceAccountGeneration, workspaceIdentityCacheKey } from '../../collab/workspace-identity';
import { openFolderDialog } from '../../providers/registry';
import {
  CODEBASE_BINDING_CHANGED_EVENT,
  CodebaseBindingError,
  fetchProjectCodebaseBinding,
  saveProjectCodebaseBinding,
  validateProjectCodebaseBinding,
} from '../../providers/codebase-binding';
import styles from './CodebaseBindingDialog.module.css';

interface Props {
  projectId: string;
  projectName: string;
  workspaceContext?: WorkspaceCollabContext | null;
  onClose: () => void;
}

interface PickedSource {
  // Tokens are signed for the picker spelling, which may be a symlink alias.
  // Keep it separate from the canonical path displayed after validation.
  sourceRoot: string;
  token?: string;
}

export function CodebaseBindingDialog(props: Props) {
  const scope = workspaceIdentityCacheKey(props.workspaceContext);
  return <CodebaseBindingDialogBody key={`${currentWorkspaceAccountGeneration()}:${scope}:${props.projectId}`} {...props} />;
}

function CodebaseBindingDialogBody({ projectId, projectName, workspaceContext, onClose }: Props) {
  const t = useT();
  const titleId = useId();
  const descriptionId = useId();
  const appId = useId();
  const appHintId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const savingRef = useRef(false);
  const pickingRef = useRef(false);
  const initialRevision = useRef<number | null | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<ProjectCodebaseBindingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [conflict, setConflict] = useState(false);
  const [picked, setPicked] = useState<PickedSource | null>(null);
  const [appPath, setAppPath] = useState('');
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<'picker' | 'save'>('save');
  const [validation, setValidation] = useState<{
    fingerprint: string;
    selection?: ProjectCodebaseBindingSelection;
    error?: string;
  } | null>(null);
  const expectedRevision = initialRevision.current;
  const relativePath = appPath.trim() || '.';
  const fingerprint = JSON.stringify([picked?.sourceRoot, relativePath, expectedRevision]);
  const invalidRelative = /^(?:[/\\]|[a-zA-Z]:)/.test(relativePath)
    || relativePath.split(/[/\\]/).includes('..');
  const selection = validation?.fingerprint === fingerprint ? validation.selection : undefined;
  const validationError = validation?.fingerprint === fingerprint ? validation.error : undefined;
  const checking = Boolean(picked && !invalidRelative && validation?.fingerprint !== fingerprint);
  const hostAvailable = isOpenDesignHostAvailable();
  const pickerAvailable = snapshot?.capabilities.canBind
    && (!snapshot.capabilities.requiresTrustedPicker || hostAvailable);
  const canSave = Boolean(pickerAvailable && picked && selection && !conflict && !loadError
    && expectedRevision !== undefined && !saving && !picking);

  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Dialog supplies the shared chrome and Escape handling. Keep keyboard
    // focus in this modal, including while the initial read is pending.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(contentRef.current?.querySelectorAll<HTMLElement>('*') ?? [])
        .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && !element.hidden);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) {
        event.preventDefault();
        contentRef.current?.focus();
        return;
      }
      if (event.shiftKey && (document.activeElement === first || !contentRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !contentRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      mounted.current = false;
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let controller: AbortController | null = null;
    const read = () => {
      if (savingRef.current) return;
      controller?.abort();
      const current = new AbortController();
      controller = current;
      void fetchProjectCodebaseBinding(projectId, { workspaceContext, signal: current.signal })
        .then((response) => {
          if (disposed || current.signal.aborted) return;
          const revision = response.binding?.revision ?? null;
          if (initialRevision.current === undefined) {
            initialRevision.current = revision;
            setAppPath(response.binding?.appRelativePath === '.' ? '' : response.binding?.appRelativePath ?? '');
          } else if (initialRevision.current !== revision) {
            setConflict(true);
          }
          setSnapshot(response);
          setLoadError(false);
        })
        .catch(() => {
          if (!disposed && !current.signal.aborted) setLoadError(true);
        })
        .finally(() => {
          if (!disposed && !current.signal.aborted) setLoading(false);
        });
    };
    read();
    window.addEventListener('focus', read);
    return () => {
      disposed = true;
      controller?.abort();
      window.removeEventListener('focus', read);
    };
  }, [projectId, workspaceContext, reload]);

  useEffect(() => {
    if (!picked || invalidRelative || expectedRevision === undefined || conflict) return;
    const controller = new AbortController();
    // A short debounce only coalesces typing, never a save or status refresh.
    const timer = window.setTimeout(() => {
      void validateProjectCodebaseBinding(projectId, {
        sourceRoot: picked.sourceRoot,
        appRelativePath: relativePath,
        expectedRevision,
      }, { workspaceContext, desktopImportToken: picked.token, signal: controller.signal })
        .then((canonical) => {
          if (!controller.signal.aborted) setValidation({ fingerprint, selection: canonical });
        })
        .catch((failure: unknown) => {
          if (controller.signal.aborted) return;
          if (failure instanceof CodebaseBindingError && failure.status === 409) setConflict(true);
          setValidation({ fingerprint, error: failure instanceof Error ? failure.message : t('codebaseBinding.saveFailed') });
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [picked, relativePath, expectedRevision, invalidRelative, conflict, fingerprint, projectId, workspaceContext, t]);

  const close = useCallback(() => {
    if (!savingRef.current) onClose();
  }, [onClose]);

  async function chooseFolder() {
    if (!pickerAvailable || pickingRef.current || savingRef.current) return;
    pickingRef.current = true;
    setPicking(true);
    setError(null);
    setErrorKind('picker');
    try {
      let next: PickedSource | null = null;
      if (hostAvailable) {
        const result = await pickHostWorkingDir();
        if (result.ok) next = { sourceRoot: result.baseDir, token: result.token };
        else if (!('canceled' in result && result.canceled)) throw new Error(t('codebaseBinding.pickerFailed'));
      } else {
        // This daemon picker is allowed only where the server does not require
        // a trusted desktop token. Never downgrade a failed host selection.
        const path = await openFolderDialog({ throwOnError: true });
        if (path) next = { sourceRoot: path };
      }
      if (mounted.current && next) {
        setValidation(null);
        setPicked(next);
      }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : t('codebaseBinding.pickerFailed'));
    } finally {
      pickingRef.current = false;
      if (mounted.current) setPicking(false);
    }
  }

  async function save() {
    if (!canSave || !picked || !selection || expectedRevision === undefined || savingRef.current) return;
    // The ref closes the same-tick double-submit window before React renders.
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setErrorKind('save');
    try {
      const response = await saveProjectCodebaseBinding(projectId, {
        sourceRoot: picked.sourceRoot,
        appRelativePath: relativePath,
        expectedRevision,
        expectedSelection: selection.selectionFingerprint,
      }, { workspaceContext, desktopImportToken: picked.token });
      window.dispatchEvent(new CustomEvent(CODEBASE_BINDING_CHANGED_EVENT, { detail: { projectId: response.projectId } }));
      if (mounted.current) onClose();
    } catch (failure) {
      if (!mounted.current) return;
      if (failure instanceof CodebaseBindingError && failure.status === 409) setConflict(true);
      setError(failure instanceof Error ? failure.message : t('codebaseBinding.saveFailed'));
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <Dialog
      className={styles.dialog}
      onClose={close}
      closeOnEscape={!saving && !picking}
      closeOnBackdrop={!saving && !picking}
      ariaLabelledBy={titleId}
      ariaDescribedBy={descriptionId}
      data-testid="codebase-binding-dialog"
      as="form"
      onSubmit={(event) => { event.preventDefault(); void save(); }}
    >
      <div ref={contentRef} className={styles.content} tabIndex={-1}>
        <header>
          <DialogTitle id={titleId}>{t(snapshot?.binding ? 'codebaseBinding.manageTitle' : 'codebaseBinding.connectTitle')}</DialogTitle>
          <p className={styles.projectName}>{projectName}</p>
          <DialogDescription id={descriptionId}>{t('codebaseBinding.description')}</DialogDescription>
        </header>
        {loading ? <p role="status">{t('codebaseBinding.loading')}</p> : null}
        {loadError ? (
          <div role="alert" className={styles.error}>
            <p>{t('codebaseBinding.loadFailed')}</p>
            <Button onClick={() => { setLoading(true); setReload((value) => value + 1); }}>{t('codebaseBinding.retry')}</Button>
          </div>
        ) : null}
        {snapshot ? (
          <>
            <section aria-labelledby={`${titleId}-storage`} className={styles.section}>
              <h3 id={`${titleId}-storage`}>{t('codebaseBinding.designStorage')}</h3>
              <p className={styles.path}>{snapshot.designStoragePath}</p>
              <p className={styles.hint}>{t('codebaseBinding.designStorageHint')}</p>
            </section>
            <section aria-labelledby={`${titleId}-source`} className={styles.section}>
              <h3 id={`${titleId}-source`}>{t('codebaseBinding.connectedSource')}</h3>
              {snapshot.status === 'unavailable' ? (
                <div role="status" className={styles.warning}>
                  <strong>{t('codebaseBinding.unavailable')}</strong>
                  <p>{snapshot.message ?? t('codebaseBinding.unavailableHint')}</p>
                </div>
              ) : null}
              {snapshot.status === 'unsupported' || !snapshot.capabilities.canBind ? (
                <p role="status" className={styles.warning}>{snapshot.message ?? t('codebaseBinding.unsupported')}</p>
              ) : null}
              <p className={styles.path}>{picked?.sourceRoot ?? snapshot.binding?.sourceRoot ?? t('codebaseBinding.noFolder')}</p>
              {snapshot.binding && !picked ? <p className={styles.hint}>{snapshot.binding.appRelativePath}</p> : null}
              <Button
                onClick={() => { void chooseFolder(); }}
                disabled={!pickerAvailable || saving || picking || conflict || loadError}
              >
                {t(snapshot.status === 'unavailable' && !picked ? 'codebaseBinding.reconnect'
                  : picked || snapshot.binding ? 'codebaseBinding.chooseAnotherFolder' : 'codebaseBinding.chooseFolder')}
              </Button>
              {!pickerAvailable && snapshot.capabilities.canBind ? <p className={styles.hint}>{t('codebaseBinding.pickerRequired')}</p> : null}
              <div className={styles.field}>
                <label htmlFor={appId}>{t('codebaseBinding.appFolder')}</label>
                <Input
                  id={appId}
                  value={appPath}
                  placeholder="."
                  aria-describedby={appHintId}
                  aria-invalid={invalidRelative || Boolean(validationError)}
                  disabled={!pickerAvailable || !picked || saving || picking || conflict || loadError}
                  onChange={(event) => { setAppPath(event.target.value); setError(null); }}
                />
                <p id={appHintId} className={styles.hint}>{t('codebaseBinding.appFolderHint')}</p>
              </div>
              {invalidRelative ? <p role="alert" className={styles.error}>{t('codebaseBinding.invalidAppFolder')}</p> : null}
              {checking && !conflict ? <p role="status" className={styles.hint}>{t('codebaseBinding.previewing')}</p> : null}
              {selection ? (
                <div className={styles.canonical} aria-live="polite">
                  <strong>{t('codebaseBinding.canonicalLocation')}</strong>
                  <p className={styles.path}>{selection.sourceRoot}</p>
                  {selection.appRelativePath !== '.' ? <p className={styles.path}>{selection.appRoot}</p> : null}
                </div>
              ) : null}
              {validationError ? <p role="alert" className={styles.error}>{validationError}</p> : null}
            </section>
          </>
        ) : null}
        {conflict ? <p role="alert" className={styles.error}>{t('codebaseBinding.changedElsewhere')}</p> : null}
        {error ? <div role="alert" className={styles.error}><p>{t(errorKind === 'picker' ? 'codebaseBinding.pickerFailed' : 'codebaseBinding.saveFailed')}</p><p>{error}</p></div> : null}
        <DialogFooter>
          <Button ref={cancelRef} onClick={close} disabled={saving}>{t('codebaseBinding.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={!canSave}>{t(saving ? 'codebaseBinding.saving' : 'codebaseBinding.save')}</Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
