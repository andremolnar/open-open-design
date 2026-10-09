import { opencodeByokModelId } from '../byok-opencode.js';
import {
  OPENCODE_PERMISSION_CAPABILITY,
  appendOpenCodePermissionBypass,
} from '../opencode-permissions.js';
import { DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

export const byokOpenCodeAgentDef = {
  id: 'byok-opencode',
  name: 'BYOK OpenCode',
  bin: 'opencode-cli',
  fallbackBins: ['opencode'],
  versionArgs: ['--version'],
  ...OPENCODE_PERMISSION_CAPABILITY,
  fallbackModels: [DEFAULT_MODEL_OPTION],
  buildArgs: (_prompt, imagePaths, _extra, options = {}) => {
    // A private V2 server receives this run's MCP/BYOK config overlay instead
    // of reusing an already-running service with an unrelated environment.
    const args = ['run', '--standalone', '--format', 'json'];
    appendOpenCodePermissionBypass(args, 'byok-opencode');
    // Stdin is text-only; explicit file arguments carry the image bytes.
    for (const imagePath of imagePaths) args.push('--file', imagePath);
    const model = opencodeByokModelId(options.model);
    if (model) args.push('-m', model);
    return args;
  },
  promptViaStdin: true,
  streamFormat: 'json-event-stream',
  eventParser: 'opencode',
  externalMcpInjection: 'opencode-env-content',
  supportsCustomModel: true,
} satisfies RuntimeAgentDef;
