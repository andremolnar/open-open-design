import type { ComfyApiGraph, ComfyInputTarget, ComfyLiteral, ComfyParameterBinding } from '@open-design/contracts';
import { isComfyLiteral } from '@open-design/contracts';
import { useI18n } from '../i18n';
import styles from './ComfySettings.module.css';

export interface ComfyBuilderState {
  graph: ComfyApiGraph;
  promptTargets: ComfyInputTarget[];
  parameters: ComfyParameterBinding[];
}

/** Suggest only unambiguous standard text slots; the operator reviews before saving. */
export function suggestComfyBuilder(graph: ComfyApiGraph): { builder: ComfyBuilderState; output: string } {
  const prompts = Object.entries(graph).flatMap(([nodeId, node]) => Object.entries(node.inputs)
    .filter(([input, value]) => typeof value === 'string' && (input === 'prompt' || (node.class_type === 'CLIPTextEncode' && input === 'text')))
    .map(([input]) => ({ nodeId, input })));
  const outputs = Object.entries(graph).filter(([, node]) => ['SaveImage', 'PreviewImage'].includes(node.class_type));
  return { builder: { graph, promptTargets: prompts.length === 1 ? prompts : [], parameters: [] },
    output: outputs.length === 1 ? outputs[0]![0] : '' };
}

export function ComfyLiteralControl({ value, onChange, label, disabled = false }: {
  value: ComfyLiteral; onChange: (value: ComfyLiteral) => void; label: string; disabled?: boolean;
}) {
  return <label>{label}{typeof value === 'boolean'
    ? <input type="checkbox" checked={value} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    : typeof value === 'number'
      ? <input type="number" step="any" required value={value} disabled={disabled} onChange={(event) => {
        if (Number.isFinite(event.target.valueAsNumber)) onChange(event.target.valueAsNumber);
      }} />
      : <textarea rows={value.includes('\n') ? 3 : 1} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />}</label>;
}

/** Only literals are editable. Connections stay intact; every runtime binding is explicit. */
export function ComfyWorkflowBuilder({ value, onChange }: { value: ComfyBuilderState; onChange: (value: ComfyBuilderState) => void }) {
  const { t } = useI18n();
  return <div className={styles.builder}>
    <h4>{t('comfy.inputs')}</h4>
    <p>{t('comfy.inputsHint')}</p>
    {Object.entries(value.graph).map(([nodeId, node]) => <div className={styles.node} key={nodeId} role="group" aria-label={`${node.class_type} · ${nodeId}`}>
      <strong>{String(node._meta?.title ?? node.class_type)} · {nodeId}</strong>
      {Object.entries(node.inputs).map(([input, literal]) => {
        const key = `${nodeId}.${input}`;
        if (!isComfyLiteral(literal)) return <p key={input}><code>{key}</code> {t('comfy.connection')} <code>{JSON.stringify(literal)}</code></p>;
        const matches = (target: ComfyInputTarget) => target.nodeId === nodeId && target.input === input;
        const parameter = value.parameters.find(matches);
        const mode = value.promptTargets.some(matches) ? 'prompt' : parameter ? 'parameter' : 'fixed';
        return <div className={styles.inputRow} key={input}>
          <code>{key} · {typeof literal}</code>
          <label>{t('comfy.source')} · {key}<select value={mode} onChange={(event) => {
            onChange({ ...value,
              promptTargets: [...value.promptTargets.filter((target) => !matches(target)), ...(event.target.value === 'prompt' ? [{ nodeId, input }] : [])],
              parameters: [...value.parameters.filter((target) => !matches(target)), ...(event.target.value === 'parameter'
                ? [{ nodeId, input, name: `node${nodeId}_${input.replace(/[^a-zA-Z0-9_]/g, '_')}`.slice(0, 64) }] : [])],
            });
          }}>
            <option value="fixed">{t('comfy.fixed')}</option>
            {typeof literal === 'string' && <option value="prompt">{t('comfy.imagePrompt')}</option>}
            <option value="parameter">{t('comfy.requestInput')}</option>
          </select></label>
          {parameter && <label>{t('comfy.requestKey')} · {key}<input value={parameter.name} maxLength={64} pattern="[a-zA-Z][a-zA-Z0-9_]*" required
            onChange={(event) => onChange({ ...value, parameters: value.parameters.map((binding) => matches(binding) ? { ...binding, name: event.target.value } : binding) })} /></label>}
          {mode === 'prompt' ? <p>{t('comfy.promptHint')}</p> : <ComfyLiteralControl label={`${t(mode === 'fixed' ? 'comfy.fixedValue' : 'comfy.exampleValue')} · ${key}`}
            value={literal} onChange={(next) => onChange({ ...value, graph: { ...value.graph,
              [nodeId]: { ...node, inputs: { ...node.inputs, [input]: next } },
            } })} />}
        </div>;
      })}
    </div>)}
  </div>;
}
