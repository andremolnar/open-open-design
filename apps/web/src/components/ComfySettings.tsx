import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import { comfyWorkflowModelId, parseComfyGraphDocument } from '@open-design/contracts';
import type { ComfySettingsResponse, ComfyWorkflowDraft, WorkspaceCollabContext } from '@open-design/contracts';
import { ComfyWorkflowBuilder, suggestComfyBuilder, type ComfyBuilderState } from './ComfyWorkflowBuilder';
import { useI18n } from '../i18n';
import { projectWorkspaceContext, projectWorkspaceScopeReady, useProjectWorkspaceScope } from '../collab/useProjectWorkspaceScope';
import { workspaceProjectHeaders } from '../state/projects';
import styles from './ComfySettings.module.css';

interface ComfyDraftState {
  connectionId: string;
  name: string;
  builder: ComfyBuilderState | null;
  graphText: string;
  output: string;
  revisionId: string;
  graphTrusted: boolean;
}
const emptyDraft = (): ComfyDraftState => ({ connectionId: '', name: '', builder: null, graphText: '', output: '', revisionId: '', graphTrusted: false });

async function request<T>(path: string, body?: unknown, headers?: HeadersInit): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const payload = await response.json();
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : payload.error?.message ?? 'ComfyUI request failed');
  return payload as T;
}

interface ComfySettingsProps { onConfiguredChange?: (configured: boolean) => void; workspaceContext?: WorkspaceCollabContext | null }
export function ComfySettings(props: ComfySettingsProps) { return <ComfySettingsPanel {...props} />; }

/** Settings owns configuration directly; tokens never go into AppConfig or localStorage. */
export function ComfySettingsPanel({ onConfiguredChange, workspaceContext }: ComfySettingsProps = {}) {
  const { t } = useI18n();
  const [data, setData] = useState<ComfySettingsResponse>({ connections: [], workflows: [] });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  const requirementsId = useId();
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const [serverName, setServerName] = useState('');
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8188');
  const [token, setToken] = useState('');
  const [trusted, setTrusted] = useState(false);
  const [addingServer, setAddingServer] = useState(false);
  const [serverStatus, setServerStatus] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState(emptyDraft);
  const { connectionId, name, builder, graphText, output, revisionId, graphTrusted } = draft;
  const setConnectionId = (value: string) => setDraft((current) => ({ ...current, connectionId: value }));
  const setName = (value: string) => setDraft((current) => ({ ...current, name: value }));
  const setGraphText = (value: string) => setDraft((current) => ({ ...current, graphText: value }));
  const setBuilder = (value: ComfyBuilderState | null) => setDraft((current) => ({ ...current, builder: value }));
  const setOutput = (value: string) => setDraft((current) => ({ ...current, output: value }));
  const setRevisionId = (value: string) => setDraft((current) => ({ ...current, revisionId: value }));
  const setGraphTrusted = (value: boolean) => setDraft((current) => ({ ...current, graphTrusted: value }));
  const refresh = async () => {
    const next = await request<ComfySettingsResponse>('/api/media/comfyui');
    setData(next);
    onConfiguredChange?.(next.connections.length > 0);
  };
  useEffect(() => { void refresh().catch((failure: Error) => setError(failure.message)); }, []);
  const act = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await operation(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t('comfy.error')); }
    finally { setBusy(false); }
  };
  const loadGraph = (raw: string) => {
    setGraphText(raw);
    const graph = parseComfyGraphDocument(raw);
    const suggested = suggestComfyBuilder(graph);
    setBuilder(suggested.builder); setOutput(suggested.output); setGraphTrusted(false);
  };
  const graph = builder?.graph;
  const outputs = graph ? Object.entries(graph).filter(([, node]) => ['SaveImage', 'PreviewImage'].includes(node.class_type)) : [];
  const enabled = data.workflows.filter((workflow) => workflow.enabled);
  const saveIssues = [
    ...(!builder ? [t('comfy.needGraph')] : []),
    ...(!name.trim() || name.length > 120 ? [t('comfy.needName')] : []),
    ...(builder && (!builder.promptTargets.length || builder.promptTargets.length > 8) ? [t('comfy.needPrompt')] : []),
    ...(builder && !outputs.some(([id]) => id === output) ? [t('comfy.needOutput')] : []),
    ...(!graphTrusted ? [t('comfy.needTrust')] : []),
  ];
  if (addingServer) return <section className={styles.panel} aria-label="ComfyUI">
    <h3>{t('comfy.addServer')}</h3>
    <Button variant="secondary" disabled={busy} onClick={() => { setToken(''); setAddingServer(false); setError(''); }}>{t('comfy.back')}</Button>
    {error && <p role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
    <fieldset disabled={busy}>
      <legend>{t('comfy.server')}</legend>
      <label>{t('comfy.name')}<input value={serverName} onChange={(event) => setServerName(event.target.value)} /></label>
      <label>{t('comfy.url')}<input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></label>
      <label>{t('comfy.token')}<input type="password" autoComplete="new-password" value={token} onChange={(event) => setToken(event.target.value)} /></label>
      <label className={styles.check}><input type="checkbox" checked={trusted} onChange={(event) => setTrusted(event.target.checked)} />{t('comfy.trustNetwork')}</label>
      <Button variant="secondary" disabled={!serverName.trim()} onClick={() => void act(async () => {
        await request('/api/media/comfyui/connections', { name: serverName, baseUrl, trustedNetwork: trusted, ...(token ? { token } : {}) });
        setToken(''); setServerName(''); setTrusted(false); await refresh(); setAddingServer(false); setNotice(t('comfy.serverSaved'));
      })}>{t('comfy.saveServer')}</Button>
    </fieldset>
  </section>;
  return <section className={styles.panel} aria-label="ComfyUI">
    <h3>ComfyUI</h3>
    <p>{t('comfy.intro')}</p>
    {error && <p role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <fieldset disabled={busy}>
      <legend>{t('comfy.activeServers')}</legend>
      {!data.connections.length && <p>{t('comfy.noServers')}</p>}
      {data.connections.map((connection) => <article key={connection.id} aria-label={connection.name}>
        <div className={styles.row}><strong>{connection.name}</strong>
          <Button variant="secondary" onClick={() => void act(async () => {
            setServerStatus((current) => ({ ...current, [connection.id]: '' }));
            try {
              await request(`/api/media/comfyui/connections/${connection.id}/check`, {});
              setServerStatus((current) => ({ ...current, [connection.id]: t('comfy.connected') }));
            } catch (failure) {
              const message = failure instanceof Error ? failure.message : t('comfy.error');
              setServerStatus((current) => ({ ...current, [connection.id]: message }));
              throw new Error(`${connection.name}: ${message}`);
            }
          })}>{t('comfy.check')}</Button>
        </div>
        <p>{connection.baseUrl} {connection.hasToken ? '🔒' : ''}</p>
        <code>{connection.id}</code>
        <p role="status">{serverStatus[connection.id] || t('comfy.notChecked')}</p>
      </article>)}
      <Button variant="secondary" onClick={() => { setError(''); setNotice(''); setAddingServer(true); }}>{t('comfy.addServer')}</Button>
    </fieldset>
    <fieldset disabled={busy}>
      <legend>{t('comfy.workflow')}</legend>
      <label>{t('comfy.preferredServer')}<select value={connectionId} onChange={(event) => setConnectionId(event.target.value)}><option value="">{t('comfy.noPreference')}</option>
        {data.connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}
      </select></label>
      <p>{t('comfy.preferenceHint')}</p>
      <label>{t('comfy.name')}<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>{t('comfy.import')}<input type="file" accept="application/json,.json" onChange={(event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setBuilder(null); setOutput(''); setGraphTrusted(false);
        void act(async () => {
          if (file.size > 2 * 1024 * 1024) throw new Error(t('comfy.invalidGraph'));
          loadGraph(await file.text());
          setDraft((current) => ({ ...current, name: current.name || file.name.replace(/\.json$/i, '').slice(0, 120) }));
        });
      }} /></label>
      <label>{t('comfy.paste')}<textarea rows={5} value={graphText} onChange={(event) => {
        setGraphText(event.target.value); setBuilder(null); setOutput(''); setGraphTrusted(false);
      }} /></label>
      <Button variant="secondary" disabled={!graphText.trim()} onClick={() => void act(async () => {
        setBuilder(null); setOutput(''); setGraphTrusted(false); loadGraph(graphText);
      })}>{t('comfy.readGraph')}</Button>
      {builder && <>
        <p>{t('comfy.reviewSuggested')}</p>
        <ComfyWorkflowBuilder value={builder} onChange={(value) => { setBuilder(value); setGraphText(JSON.stringify(value.graph, null, 2)); setGraphTrusted(false); }} />
      </>}
      <label>{t('comfy.output')}<select value={output} onChange={(event) => setOutput(event.target.value)}><option value="">—</option>
        {outputs.map(([id, node]) => <option value={id} key={id}>{String(node._meta?.title ?? node.class_type)} · {id} · PNG #0</option>)}
      </select></label>
      <p>{t('comfy.outputHint')}</p>
      <label>{t('comfy.revision')}<select value={revisionId} onChange={(event) => setRevisionId(event.target.value)}><option value="">{t('comfy.newWorkflow')}</option>
        {data.workflows.filter((workflow, index, all) => all.findIndex((item) => item.id === workflow.id) === index).map((workflow) => <option value={workflow.id} key={workflow.id}>{workflow.name}</option>)}
      </select></label>
      <label className={styles.check}><input type="checkbox" checked={graphTrusted} onChange={(event) => setGraphTrusted(event.target.checked)} />{t('comfy.trustGraph')}</label>
      {saveIssues.length > 0 && <div id={requirementsId} className={styles.requirements} aria-live="polite"><strong>{t('comfy.beforeSave')}</strong>
        <ul>{saveIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
      <Button variant="secondary" disabled={busy} aria-describedby={saveIssues.length ? requirementsId : undefined} onClick={() => void act(async () => {
        if (saveIssues.length) throw new Error(saveIssues.join(' '));
        if (!builder) return;
        await request(revisionId ? `/api/media/comfyui/workflows/${revisionId}/versions` : '/api/media/comfyui/workflows', {
          name, ...(connectionId ? { connectionId } : {}), ...builder, output: { nodeId: output, index: 0 },
        });
        await refresh(); setNotice(t('comfy.saved'));
      })}>{t('comfy.saveWorkflow')}</Button>
    </fieldset>
    <div className={styles.cards}>
      {data.workflows.map((workflow) => <article key={`${workflow.id}:${workflow.version}`}>
        <strong>{workflow.name} · v{workflow.version}</strong>
        <p>{workflow.enabled ? t('comfy.enabled') : t('comfy.disabled')}</p>
        <p>{t('comfy.preferredServer')}: {data.connections.find((connection) => connection.id === workflow.connectionId)?.name || t('comfy.noPreference')}</p>
        <code>{comfyWorkflowModelId(workflow.id, workflow.version)}</code>
        <p>{t('comfy.modelIdHint')}</p>
        {workflow.output && <p>{t('comfy.output')}: {workflow.output.nodeId} · PNG #{workflow.output.index}</p>}
        {!!workflow.parameters?.length && <p>{t('comfy.requestInputs')}: {workflow.parameters.map((parameter) => `${parameter.name} (${parameter.type})`).join(', ')}</p>}
        <div className={styles.row}>
          <Button disabled={busy} variant="secondary" onClick={() => void act(async () => {
            const draft = await request<ComfyWorkflowDraft>(`/api/media/comfyui/workflows/${workflow.id}/${workflow.version}`);
            setName(draft.name); setConnectionId(draft.connectionId ?? ''); setRevisionId(workflow.id);
            setBuilder({ graph: draft.graph, promptTargets: draft.promptTargets, parameters: draft.parameters ?? [] });
            setOutput(draft.output.nodeId); setGraphText(JSON.stringify(draft.graph, null, 2)); setGraphTrusted(false);
          })}>{t('comfy.editVersion')}</Button>
          <Button disabled={busy} variant="secondary" onClick={() => void act(async () => {
            const result = await request<{ outputNodes: string[] }>(`/api/media/comfyui/workflows/${workflow.id}/${workflow.version}/validate`, {});
            await refresh(); setNotice(`${t('comfy.validated')} ${result.outputNodes.join(', ')}`);
          })}>{t('comfy.validate')}</Button>
          <Button disabled={busy} variant="secondary" onClick={() => void act(async () => {
            await request(`/api/media/comfyui/workflows/${workflow.id}/${workflow.version}/enabled`, { enabled: !workflow.enabled }); await refresh();
          })}>{workflow.enabled ? t('comfy.disable') : t('comfy.enable')}</Button>
        </div>
      </article>)}
    </div>
    {!enabled.length && <p>{t('comfy.noEnabledWorkflow')}</p>}
    {!!data.executions?.length && <fieldset><legend>{t('comfy.recordedJobs')}</legend>
      <p>{t('comfy.recordedJobsHint')}</p>
      <Button variant="secondary" disabled={busy} onClick={() => void act(refresh)}>{t('comfy.refreshJobs')}</Button>
      {data.executions.map((execution) => <ComfyRecordedJob key={execution.taskId} execution={execution}
        workspaceContext={workspaceContext ?? null} onChanged={refresh} />)}
    </fieldset>}
  </section>;
}

function ComfyRecordedJob({ execution, workspaceContext, onChanged }: {
  execution: NonNullable<ComfySettingsResponse['executions']>[number];
  workspaceContext: WorkspaceCollabContext | null; onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const scope = useProjectWorkspaceScope(execution.projectId, workspaceContext, null);
  const context = projectWorkspaceContext(scope.scope);
  const ready = projectWorkspaceScopeReady(scope.scope);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const act = async (recover: boolean) => {
    setBusy(true); setError('');
    try {
      if (recover) await request(`/api/projects/${encodeURIComponent(execution.projectId)}/media/generate`,
        { surface: 'image', model: execution.model, resumeTaskId: execution.taskId }, context ? workspaceProjectHeaders(context) : {});
      else await request(`/api/media/comfyui/executions/${execution.taskId}/release`, { confirmUnknown: true });
      await onChanged();
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('comfy.error')); }
    finally { setBusy(false); }
  };
  return <article aria-label={execution.taskId}>
    <code>{execution.taskId} · {execution.projectId} · {execution.connectionId}</code>
    <p>{execution.phase}</p>
    {error && <p role="alert">{error}</p>}
    {execution.promptId && <Button variant="secondary" disabled={busy || execution.running || !ready}
      onClick={() => void act(true)}>{t('comfy.recover')}</Button>}
    {!execution.running && <>
      <label className={styles.check}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{t('comfy.confirmRelease')}</label>
      <Button variant="secondary" disabled={busy || !confirmed} onClick={() => void act(false)}>{t('comfy.release')}</Button>
    </>}
  </article>;
}
