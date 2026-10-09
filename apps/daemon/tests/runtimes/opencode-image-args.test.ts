import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentCapabilities } from '../../src/runtimes/capabilities.js';
import { byokOpenCodeAgentDef } from '../../src/runtimes/defs/byok-opencode.js';
import { opencodeAgentDef } from '../../src/runtimes/defs/opencode.js';
import type { RuntimeAgentDef } from '../../src/runtimes/types.js';

// Argument construction only consumes the shared default model. Avoid loading
// unrelated ACP discovery and process-spawning dependencies in this pure test.
vi.mock('../../src/runtimes/defs/shared.js', async () => {
  const { DEFAULT_MODEL_OPTION } = await import('../../src/runtimes/models.js');
  return { DEFAULT_MODEL_OPTION };
});

const BASE_ARGS = ['run', '--standalone', '--format', 'json'];
const PROMPT = 'Compare the attached reference images.';
const IMAGE_PATHS = [
  '/workspace/project/reference images/first view.png',
  '/workspace/project/reference images/第二稿 $(preview).jpg',
];
const FILE_ARGS = ['--file', IMAGE_PATHS[0], '--file', IMAGE_PATHS[1]];

const adapters: {
  def: RuntimeAgentDef;
  model: string;
  expectedModel: string;
}[] = [
  {
    def: opencodeAgentDef,
    model: 'anthropic/claude-sonnet-4-5',
    expectedModel: 'anthropic/claude-sonnet-4-5',
  },
  {
    def: byokOpenCodeAgentDef,
    model: 'gpt-4o-mini',
    expectedModel: 'open-design-byok/gpt-4o-mini',
  },
];

describe.each(adapters)('$def.id image arguments', ({ def, model, expectedModel }) => {
  beforeEach(() => {
    agentCapabilities.delete(def.id);
  });

  afterEach(() => {
    agentCapabilities.delete(def.id);
  });

  it('attaches a path containing spaces as one literal argv value', () => {
    expect(def.buildArgs(PROMPT, [IMAGE_PATHS[0]!], [])).toEqual([
      ...BASE_ARGS,
      '--file',
      IMAGE_PATHS[0],
    ]);
    expect(def.promptViaStdin).toBe(true);
  });

  it('attaches each image in order without shell quoting or changing the paths', () => {
    const paths = [...IMAGE_PATHS];
    const args = def.buildArgs(PROMPT, paths, []);

    expect(args).toEqual([...BASE_ARGS, ...FILE_ARGS]);
    expect(paths).toEqual(IMAGE_PATHS);
    expect(args).not.toContain(PROMPT);
    expect(args).not.toContain('-');
    expect(def.promptViaStdin).toBe(true);
  });

  it('leaves the no-image invocation unchanged', () => {
    expect(def.buildArgs(PROMPT, [], [])).toEqual(BASE_ARGS);
    expect(def.promptViaStdin).toBe(true);
  });

  it('only attaches explicit image inputs, not path mentions in the stdin prompt', () => {
    expect(def.buildArgs(`Inspect @${IMAGE_PATHS[0]}`, [], [])).toEqual(BASE_ARGS);
  });

  it.each([false, true])('preserves model selection and permission capability %s with images', (skipPermissions) => {
    agentCapabilities.set(def.id, { skipPermissions });

    expect(def.buildArgs(PROMPT, [...IMAGE_PATHS], [], { model })).toEqual([
      ...BASE_ARGS,
      ...(skipPermissions ? ['--auto'] : []),
      ...FILE_ARGS,
      '-m',
      expectedModel,
    ]);
  });
});

describe('OpenCode image attachments on a resumed session', () => {
  it('preserves the existing resume and model flags alongside new attachments', () => {
    agentCapabilities.delete('opencode');

    expect(opencodeAgentDef.buildArgs(PROMPT, [...IMAGE_PATHS], [], {
      model: 'anthropic/claude-sonnet-4-5',
    }, {
      resumeSessionId: 'ses_image_followup',
    })).toEqual([
      ...BASE_ARGS,
      ...FILE_ARGS,
      '-s',
      'ses_image_followup',
      '-m',
      'anthropic/claude-sonnet-4-5',
    ]);
  });
});
