import { useEffect, useState } from 'react';
import { Button } from '@open-design/components';
import { comfyWorkflowModelId } from '@open-design/contracts';
import type { ComfyApiGraph, ComfySettingsResponse, ProjectMediaTask, WorkspaceCollabContext } from '@open-design/contracts';
import { useI18n } from '../i18n';
import { useRoute } from '../router';
import { projectWorkspaceContext, projectWorkspaceScopeReady, useProjectWorkspaceScope } from '../collab/useProjectWorkspaceScope';
import { workspaceProjectHeaders } from '../state/projects';
import { projectFileUrl } from '../providers/registry';
import styles from './ComfySettings.module.css';

async function request<T>(path: string, body?: unknown, headers?: HeadersInit): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const payload = await response.json();
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : payload.error?.message ?? 'ComfyUI request failed');
  return payload as T;
}

export function ComfySettings(props: { workspaceContext: WorkspaceCollabContext | null;
  projects: Array<{ id: string; name: string; workspaceId: string | null }> }) {
  const route = useRoute();
  const { t } = useI18n();
  const [selectedProjectId, setSelectedProjectId] = useState(route.kind === 'project' ? route.projectId : '');
  const selectedProject = props.projects.find((project) => project.id === selectedProjectId);
  return <>
    <label className={styles.destination}>{t('comfy.chooseProject')}
      <select value={selectedProject?.id ?? ''} onChange={(event) => setSelectedProjectId(event.target.value)}>
        <option value="">—</option>
        {props.projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
      </select>
    </label>
    {selectedProject ? <ProjectComfySettings key={selectedProject.id} projectId={selectedProject.id}
      workspaceContext={props.workspaceContext} persistedProjectWorkspaceId={selectedProject.workspaceId} />
      : <ComfySettingsPanel projectId={null} ready={false} workspaceContext={null} />}
  </>;
}

function ProjectComfySettings(props: { projectId: string; workspaceContext: WorkspaceCollabContext | null; persistedProjectWorkspaceId: string | null }) {
  const scope = useProjectWorkspaceScope(props.projectId, props.workspaceContext, props.persistedProjectWorkspaceId);
  const context = projectWorkspaceContext(scope.scope);
  return <ComfySettingsPanel key={`${props.projectId}:${context?.workspaceId ?? ''}:${context?.workspaceMemberId ?? ''}:${scope.loading}`}
    projectId={props.projectId} ready={projectWorkspaceScopeReady(scope.scope)} workspaceContext={context} />;
}

/** Settings owns configuration directly; tokens never go into AppConfig or localStorage. */
export function ComfySettingsPanel({ projectId, ready, workspaceContext }: {
  projectId: string | null; ready: boolean; workspaceContext: WorkspaceCollabContext | null;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<ComfySettingsResponse>({ connections: [], workflows: [] });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [serverName, setServerName] = useState('');
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8188');
  const [token, setToken] = useState('');
  const [trusted, setTrusted] = useState(false);
  const [connectionId, setConnectionId] = useState('');
  const [name, setName] = useState('');
  const [graph, setGraph] = useState<ComfyApiGraph | null>(null);
  const [promptTarget, setPromptTarget] = useState('');
  const [output, setOutput] = useState('');
  const [revisionId, setRevisionId] = useState('');
  const [graphTrusted, setGraphTrusted] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [confirmRun, setConfirmRun] = useState(false);
  const [task, setTask] = useState<ProjectMediaTask | null>(null);
  const [pollEpoch, setPollEpoch] = useState(0);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const headers = workspaceContext ? workspaceProjectHeaders(workspaceContext) : {};
  const refresh = async () => {
    const next = await request<ComfySettingsResponse>('/api/media/comfyui');
    setData(next);
    setConnectionId((current) => current || next.connections[0]?.id || '');
  };
  useEffect(() => { void refresh().catch((failure: Error) => setError(failure.message)); }, []);
  const principal = workspaceContext ? `${workspaceContext.workspaceId}:${workspaceContext.workspaceMemberId}` : '';
  useEffect(() => {
    if (!projectId || !ready) return;
    let active = true;
    let timeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const payload = await request<{ tasks: ProjectMediaTask[] }>(`/api/projects/${encodeURIComponent(projectId)}/media/tasks?includeDone=1`, undefined, headers);
        if (!active) return;
        const latest = payload.tasks.filter((item) => item.model?.startsWith('comfyui/')).sort((a, b) => b.startedAt - a.startedAt)[0];
        setTask(latest ?? null);
        if (latest && ['running', 'queued'].includes(latest.status)) timeout = setTimeout(poll, 1500);
      } catch (failure) { if (active) setError(failure instanceof Error ? failure.message : t('comfy.error')); }
    };
    void poll();
    return () => { active = false; clearTimeout(timeout); };
  }, [projectId, ready, principal, pollEpoch]);
  const act = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await operation(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t('comfy.error')); }
    finally { setBusy(false); }
  };
  const targets = graph ? Object.entries(graph).flatMap(([id, node]) => Object.entries(node.inputs ?? {})
    .filter(([, value]) => typeof value === 'string').map(([input]) => ({ key: JSON.stringify([id, input]), label: `${node._meta?.title ?? node.class_type} · ${id}.${input}` }))) : [];
  const outputs = graph ? Object.entries(graph).filter(([, node]) => ['SaveImage', 'PreviewImage'].includes(node.class_type)) : [];
  const enabled = data.workflows.filter((workflow) => workflow.enabled);
  const selected = enabled.find((workflow) => comfyWorkflowModelId(workflow.id, workflow.version) === selectedModel);
  const selectedConnection = data.connections.find((connection) => connection.id === selected?.connectionId);
  const running = task && ['queued', 'running'].includes(task.status);
  return <section className={styles.panel} aria-label="ComfyUI">
    <h3>ComfyUI</h3>
    <p>{t('comfy.intro')}</p>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <fieldset disabled={busy}>
      <legend>{t('comfy.server')}</legend>
      <label>{t('comfy.name')}<input value={serverName} onChange={(event) => setServerName(event.target.value)} /></label>
      <label>{t('comfy.url')}<input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></label>
      <label>{t('comfy.token')}<input type="password" autoComplete="new-password" value={token} onChange={(event) => setToken(event.target.value)} /></label>
      <label className={styles.check}><input type="checkbox" checked={trusted} onChange={(event) => setTrusted(event.target.checked)} />{t('comfy.trustNetwork')}</label>
      <Button variant="secondary" disabled={!serverName.trim()} onClick={() => void act(async () => {
        await request('/api/media/comfyui/connections', { name: serverName, baseUrl, trustedNetwork: trusted, ...(token ? { token } : {}) });
        setToken(''); setServerName(''); await refresh(); setNotice(t('comfy.saved'));
      })}>{t('comfy.saveServer')}</Button>
      {data.connections.map((connection) => <div className={styles.row} key={connection.id}>
        <span>{connection.name} · {connection.baseUrl} {connection.hasToken ? '🔒' : ''}</span>
        <Button variant="secondary" onClick={() => void act(async () => {
          await request(`/api/media/comfyui/connections/${connection.id}/check`, {}); setNotice(t('comfy.connected'));
        })}>{t('comfy.check')}</Button>
      </div>)}
    </fieldset>
    <fieldset disabled={busy}>
      <legend>{t('comfy.workflow')}</legend>
      <label>{t('comfy.server')}<select value={connectionId} onChange={(event) => setConnectionId(event.target.value)}><option value="">—</option>
        {data.connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}
      </select></label>
      <label>{t('comfy.name')}<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>{t('comfy.import')}<input type="file" accept="application/json,.json" onChange={(event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setGraph(null); setPromptTarget(''); setOutput(''); setGraphTrusted(false);
        void act(async () => {
          if (file.size > 2 * 1024 * 1024) throw new Error(t('comfy.invalidGraph'));
          const parsed = JSON.parse(await file.text()) as ComfyApiGraph;
          if (!parsed || Array.isArray(parsed) || parsed.nodes || !Object.values(parsed).every((node) => node && typeof node.class_type === 'string' && node.inputs && typeof node.inputs === 'object')) {
            throw new Error(t('comfy.invalidGraph'));
          }
          setGraph(parsed);
        });
      }} /></label>
      <label>{t('comfy.promptTarget')}<select value={promptTarget} onChange={(event) => setPromptTarget(event.target.value)}><option value="">—</option>
        {targets.map((target) => <option key={target.key} value={target.key}>{target.label}</option>)}
      </select></label>
      <label>{t('comfy.output')}<select value={output} onChange={(event) => setOutput(event.target.value)}><option value="">—</option>
        {outputs.map(([id, node]) => <option value={id} key={id}>{String(node._meta?.title ?? node.class_type)} · {id} · PNG #0</option>)}
      </select></label>
      <label>{t('comfy.revision')}<select value={revisionId} onChange={(event) => setRevisionId(event.target.value)}><option value="">{t('comfy.newWorkflow')}</option>
        {data.workflows.filter((workflow, index, all) => all.findIndex((item) => item.id === workflow.id) === index).map((workflow) => <option value={workflow.id} key={workflow.id}>{workflow.name}</option>)}
      </select></label>
      <label className={styles.check}><input type="checkbox" checked={graphTrusted} onChange={(event) => setGraphTrusted(event.target.checked)} />{t('comfy.trustGraph')}</label>
      <Button variant="secondary" disabled={!graph || !connectionId || !name.trim() || !promptTarget || !output || !graphTrusted} onClick={() => void act(async () => {
        const [nodeId, input] = JSON.parse(promptTarget) as [string, string];
        await request(revisionId ? `/api/media/comfyui/workflows/${revisionId}/versions` : '/api/media/comfyui/workflows', {
          name, connectionId, graph, promptTargets: [{ nodeId, input }], output: { nodeId: output, index: 0 },
        });
        await refresh(); setNotice(t('comfy.saved'));
      })}>{t('comfy.saveWorkflow')}</Button>
    </fieldset>
    <div className={styles.cards}>
      {data.workflows.map((workflow) => <article key={`${workflow.id}:${workflow.version}`}>
        <strong>{workflow.name} · v{workflow.version}</strong>
        <p>{data.connections.find((connection) => connection.id === workflow.connectionId)?.name} · {workflow.enabled ? t('comfy.enabled') : t('comfy.disabled')}</p>
        <code>{comfyWorkflowModelId(workflow.id, workflow.version)}</code>
        <div className={styles.row}>
          <Button disabled={busy} variant="secondary" onClick={() => void act(async () => {
            const result = await request<{ outputNodes: string[] }>(`/api/media/comfyui/workflows/${workflow.id}/${workflow.version}/validate`, {});
            await refresh(); setNotice(`${t('comfy.validated')} ${result.outputNodes.join(', ')}`);
          })}>{t('comfy.validate')}</Button>
          <Button disabled={busy || (!workflow.enabled && !workflow.schemaCheckedAt)} variant="secondary" onClick={() => void act(async () => {
            await request(`/api/media/comfyui/workflows/${workflow.id}/${workflow.version}/enabled`, { enabled: !workflow.enabled }); await refresh();
          })}>{workflow.enabled ? t('comfy.disable') : t('comfy.enable')}</Button>
        </div>
      </article>)}
    </div>
    <fieldset disabled={busy || Boolean(running)}>
      <legend>{t('comfy.test')}</legend>
      <p>{projectId ? `${t('comfy.destination')} ${projectId}` : t('comfy.openProject')}</p>
      <label>{t('comfy.workflow')}<select value={selectedModel} onChange={(event) => { setSelectedModel(event.target.value); setConfirmRun(false); }}><option value="">—</option>
        {enabled.map((workflow) => <option key={comfyWorkflowModelId(workflow.id, workflow.version)} value={comfyWorkflowModelId(workflow.id, workflow.version)}>{workflow.name} · v{workflow.version}</option>)}
      </select></label>
      <label>{t('comfy.prompt')}<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>
      {selectedConnection && <p>{selectedConnection.name} · {selectedConnection.baseUrl}</p>}
      <label className={styles.check}><input type="checkbox" checked={confirmRun} onChange={(event) => setConfirmRun(event.target.checked)} />{t('comfy.confirmRun')}</label>
      <Button variant="primary" disabled={!projectId || !ready || !selected || !prompt.trim() || !confirmRun} onClick={() => void act(async () => {
        if (!projectId) return;
        const result = await request<{ taskId: string; status: 'running'; startedAt: number }>(`/api/projects/${encodeURIComponent(projectId)}/media/generate`, { surface: 'image', model: selectedModel, prompt, requestId: crypto.randomUUID() }, headers);
        setTask({ ...result, model: selectedModel, endedAt: null, elapsed: 0, progress: [], progressCount: 0 }); setConfirmRun(false); setPollEpoch((value) => value + 1);
      })}>{t('comfy.run')}</Button>
    </fieldset>
    {task && <article aria-live="polite">
      <strong>{task.status} · {task.taskId}</strong>
      <p>{task.progress.at(-1)}</p>
      {task.error && <p role="alert">{task.error.message}</p>}
      {task.comfy?.promptId && <p>ComfyUI prompt: {task.comfy.promptId}</p>}
      {task.comfy?.promptId && !running && task.status !== 'done' && <Button disabled={busy || !ready} variant="secondary" onClick={() => void act(async () => {
        if (!projectId) return;
        await request(`/api/projects/${encodeURIComponent(projectId)}/media/generate`, {
          surface: 'image', model: task.model, resumeTaskId: task.taskId,
        }, headers);
        setTask({ ...task, status: 'running', endedAt: null });
        setPollEpoch((value) => value + 1);
      })}>{t('comfy.recover')}</Button>}
      {task.comfy && !task.comfy.releasedAt && !running && task.status !== 'done' && <div>
        <label className={styles.check}><input type="checkbox" checked={confirmRelease} onChange={(event) => setConfirmRelease(event.target.checked)} />{t('comfy.confirmRelease')}</label>
        <Button disabled={busy || !confirmRelease} variant="secondary" onClick={() => void act(async () => {
          await request(`/api/media/comfyui/executions/${task.taskId}/release`, { confirmUnknown: true });
          setConfirmRelease(false); setPollEpoch((value) => value + 1); setNotice(t('comfy.released'));
        })}>{t('comfy.release')}</Button>
      </div>}
      {task.status === 'done' && task.file && projectId && <>
        <p>{t('comfy.imported')} {task.file.name}</p>
        <img className={styles.preview} src={projectFileUrl(projectId, task.file.name, workspaceContext)} alt={task.file.name} />
      </>}
    </article>}
  </section>;
}
