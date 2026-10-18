import type { ComfyApiGraph, ComfyInputTarget, ComfyLiteral } from '@open-design/contracts';
import { comfyEditableFields } from '@open-design/contracts';
import { useI18n } from '../i18n';
import styles from './ComfySettings.module.css';

export interface ComfyBuilderState {
  graph: ComfyApiGraph;
  promptTargets: ComfyInputTarget[];
  inputMode: 'automatic';
}

/** Suggest only unambiguous standard text slots; the operator reviews before saving. */
export function suggestComfyBuilder(graph: ComfyApiGraph): { builder: ComfyBuilderState; output: string } {
  const prompts = comfyEditableFields(graph).filter((field) => field.type === 'string' && field.input !== 'negative_prompt')
    .map((field) => ({ nodeId: field.nodeId, input: field.input }));
  const outputs = Object.entries(graph).filter(([, node]) => ['SaveImage', 'PreviewImage'].includes(node.class_type));
  return { builder: { graph, promptTargets: prompts.length === 1 ? prompts : [], inputMode: 'automatic' },
    output: outputs.length === 1 ? outputs[0]![0] : '' };
}

export function ComfyLiteralControl({ value, onChange, label, integer = false }: {
  value: ComfyLiteral; onChange: (value: ComfyLiteral) => void; label: string; integer?: boolean;
}) {
  return <label>{label}{typeof value === 'boolean'
    ? <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
    : typeof value === 'number'
      ? <input type="number" step={integer ? 1 : 'any'} required value={value} onChange={(event) => {
        if (Number.isFinite(event.target.valueAsNumber) && (!integer || Number.isSafeInteger(event.target.valueAsNumber))) onChange(event.target.valueAsNumber);
      }} />
      : <textarea rows={value.includes('\n') ? 3 : 1} value={value} onChange={(event) => onChange(event.target.value)} />}</label>;
}

/** Editing a typed default also exposes it to discovery; no binding/key UI. */
export function ComfyWorkflowBuilder({ value, onChange }: { value: ComfyBuilderState; onChange: (value: ComfyBuilderState) => void }) {
  const { t } = useI18n();
  const fields = comfyEditableFields(value.graph, value.promptTargets);
  const promptFields = fields.filter((field) => field.type === 'string');
  return <div className={styles.builder}>
    <h4>{t('comfy.inputs')}</h4>
    <p>{t('comfy.inputsHint')}</p>
    {(promptFields.length > 1 || !value.promptTargets.length) && <label>{t('comfy.promptField')}<select value={value.promptTargets[0] ? `${value.promptTargets[0].nodeId}.${value.promptTargets[0].input}` : ''}
      onChange={(event) => {
        const selected = promptFields.find((field) => `${field.nodeId}.${field.input}` === event.target.value);
        onChange({ ...value, promptTargets: selected ? [{ nodeId: selected.nodeId, input: selected.input }] : [] });
      }}><option value="">—</option>{promptFields.map((field) => <option key={field.name} value={`${field.nodeId}.${field.input}`}>{field.label}</option>)}</select></label>}
    {Object.entries(value.graph).filter(([nodeId]) => fields.some((field) => field.nodeId === nodeId)).map(([nodeId, node]) => <div className={styles.node} key={nodeId} role="group" aria-label={`${node.class_type} · ${nodeId}`}>
      <strong>{String(node._meta?.title ?? node.class_type)} · {nodeId}</strong>
      {fields.filter((field) => field.nodeId === nodeId).map((field) => <div className={styles.inputRow} key={field.name}>
          <ComfyLiteralControl label={field.label} integer={field.integer ?? false}
            value={field.defaultValue} onChange={(next) => onChange({ ...value, graph: { ...value.graph,
              [nodeId]: { ...node, inputs: { ...node.inputs, [field.input]: next } },
            } })} />
          {field.usesPrompt && <small>{t('comfy.promptDefaultHint')}</small>}
        </div>)}
      {Object.entries(node.inputs).some(([input]) => !fields.some((field) => field.nodeId === nodeId && field.input === input)) && <details className={styles.storedValues}>
        <summary>{t('comfy.storedValues')}</summary>
        <dl>{Object.entries(node.inputs).filter(([input]) => !fields.some((field) => field.nodeId === nodeId && field.input === input)).map(([input, stored]) => <div key={input}>
          <dt>{input}</dt><dd>{typeof stored === 'string' ? stored : JSON.stringify(stored)}</dd>
        </div>)}</dl>
      </details>}
    </div>)}
    {Object.entries(value.graph).some(([nodeId]) => !fields.some((field) => field.nodeId === nodeId)) && <details className={styles.storedValues}>
      <summary>{t('comfy.storedValues')}</summary>
      {Object.entries(value.graph).filter(([nodeId]) => !fields.some((field) => field.nodeId === nodeId)).map(([nodeId, node]) => <div key={nodeId}>
        <strong>{String(node._meta?.title ?? node.class_type)} · {nodeId}</strong>
        <dl>{Object.entries(node.inputs).map(([input, stored]) => <div key={input}><dt>{input}</dt><dd>{typeof stored === 'string' ? stored : JSON.stringify(stored)}</dd></div>)}</dl>
      </div>)}
    </details>}
  </div>;
}
