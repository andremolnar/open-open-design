import { afterEach, describe, expect, it } from 'vitest';
import { parseOpenCodeModels, opencodeAgentDef } from '../../src/runtimes/defs/opencode.js';
import { getRememberedLiveModels, isKnownModel, rememberLiveModels, sanitizeCustomModel } from '../../src/runtimes/models.js';

const previousModels = getRememberedLiveModels('opencode');
afterEach(() => rememberLiveModels('opencode', previousModels));

describe('OpenCode V2 model references', () => {
  it('combines the provider and opaque catalog key, preserving spaces, nested IDs and aliases', () => {
    const models = parseOpenCodeModels([
      { providerID: 'local', id: 'Example 35B Q8', name: 'Local example' },
      { providerID: 'router', id: 'vendor/example-model', name: 'Shared display name' },
      { providerID: 'other', id: 'vendor/example-model', name: 'Shared display name' },
      { providerID: 'local', id: 'coding-alias', modelID: 'Upstream Model With Spaces' },
      { providerID: 'local', id: 'Example 35B Q8' },
      { providerID: 'local', id: 'hidden', enabled: false },
    ]);
    expect(models?.map((model) => model.id)).toEqual([
      'default', 'local/Example 35B Q8', 'router/vendor/example-model',
      'other/vendor/example-model', 'local/coding-alias',
    ]);
    // Display the reference so identically named models remain distinguishable.
    expect(models?.slice(1).map((model) => model.label)).toEqual(models?.slice(1).map((model) => model.id));
  });

  it('accepts OpenCode custom IDs with literal spaces without weakening other agents', () => {
    const id = 'local/Example  35B Q8';
    expect(sanitizeCustomModel(id, 'opencode')).toBe(id);
    expect(sanitizeCustomModel(id, 'codex')).toBeNull();
    expect(sanitizeCustomModel(id)).toBeNull();
    expect(sanitizeCustomModel('router/vendor/example-model', 'opencode')).toBe('router/vendor/example-model');
  });

  it('preserves routed aliases beginning with a tilde', () => {
    const id = 'router/~vendor/example-latest';
    expect(parseOpenCodeModels([{ providerID: 'router', id: '~vendor/example-latest' }])?.[1]?.id).toBe(id);
    expect(sanitizeCustomModel(id, 'opencode')).toBe(id);
  });

  it('makes discovered space-containing models known and forwards the exact reference as one argument', () => {
    const id = 'local/Example 35B Q8';
    rememberLiveModels('opencode', parseOpenCodeModels([
      { providerID: 'local', id: 'Example 35B Q8', variants: [{ id: 'high' }] },
    ]) ?? []);
    expect(isKnownModel(opencodeAgentDef, id)).toBe(true);
    expect(opencodeAgentDef.buildArgs('', [], [], { model: id, reasoning: 'high' }).slice(-2))
      .toEqual(['-m', `${id}#high`]);
  });

  it('rejects malformed references, controls and shell metacharacters rather than treating them as names', () => {
    for (const id of ['--model', 'no-provider', '/model', 'local/', 'local/   ', 'bad provider/model',
      'local/model\nname', 'local/model\tname', 'local/model\0name', 'local/model\n',
      'local/$(command)', 'local/a;b', 'local/a&b', 'local/a"b', 'local/a%PATH%', 'local/model#extra',
      `local/${'x'.repeat(201)}`]) {
      expect(sanitizeCustomModel(id, 'opencode'), JSON.stringify(id)).toBeNull();
    }
    expect(parseOpenCodeModels([{ providerID: 'bad provider', id: 'vendor/model' }])).toBeNull();
  });
});
