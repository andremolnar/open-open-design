import { OpenCode } from '@opencode/client';
import { Service } from '@opencode/client/service';
import { DEFAULT_MODEL_OPTION } from './shared.js';
import {
  OPENCODE_PERMISSION_CAPABILITY,
  appendOpenCodePermissionBypass,
} from '../opencode-permissions.js';
import { getRememberedLiveModels } from '../models.js';
import type { RuntimeAgentDef, RuntimeModelOption } from '../types.js';

const OPENCODE_VARIANT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const OPENCODE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._/:@-]*$/u;

function reasoningOptions(ids: readonly string[]): RuntimeModelOption[] {
  return [
    { id: 'default', label: 'Default' },
    ...ids.map((id) => ({ id, label: id })),
  ];
}

const OPENCODE_FALLBACK_MODELS: RuntimeModelOption[] = [
  DEFAULT_MODEL_OPTION,
  {
    id: 'anthropic/claude-sonnet-4-5',
    label: 'anthropic/claude-sonnet-4-5',
  },
  {
    id: 'openai/gpt-5.6-sol',
    label: 'openai/gpt-5.6-sol',
  },
  {
    id: 'openai/gpt-5.6-terra',
    label: 'openai/gpt-5.6-terra',
  },
  {
    id: 'openai/gpt-5.6-luna',
    label: 'openai/gpt-5.6-luna',
  },
  { id: 'openai/gpt-5', label: 'openai/gpt-5' },
  { id: 'google/gemini-2.5-pro', label: 'google/gemini-2.5-pro' },
];

/**
 * Normalize the V2 model catalog. The CLI's `models` command only prints IDs;
 * the client returns variant metadata needed for the reasoning picker.
 */
export function parseOpenCodeModels(catalog: readonly { id: string; providerID: string; variants?: readonly { id: string }[]; enabled?: boolean }[]): RuntimeModelOption[] | null {
  const models: RuntimeModelOption[] = [DEFAULT_MODEL_OPTION];
  const seen = new Set<string>();
  for (const model of catalog) {
    // V2 Model.Info.id is the CLI model reference, including the provider
    // namespace (which can differ from providerID, e.g. OpenRouter routes).
    const id = model.id;
    if (model.enabled === false) continue;
    if (!OPENCODE_MODEL_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    const variantIds = (model.variants ?? []).map((variant) => variant.id)
      .filter((variant) => OPENCODE_VARIANT_ID.test(variant));
    models.push({
      id,
      label: id,
      ...(variantIds.length > 0
        ? { reasoningOptions: reasoningOptions(variantIds) }
        : {}),
    });
  }
  return models.length > 1 ? models : null;
}

function supportsOpenCodeVariant(
  modelId: string | null | undefined,
  variant: string | null | undefined,
): variant is string {
  if (!modelId || modelId === 'default' || !variant || variant === 'default') return false;
  const live = getRememberedLiveModels('opencode').find((model) => model.id === modelId);
  return Boolean(live?.reasoningOptions?.some((option) => option.id === variant));
}

export const opencodeAgentDef = {
    id: 'opencode',
    name: 'OpenCode',
    bin: 'opencode-cli',
    fallbackBins: ['opencode'],
    versionArgs: ['--version'],
    ...OPENCODE_PERMISSION_CAPABILITY,
    fetchModels: async (resolvedBin, env) => {
      const endpoint = await Service.ensure({
        version: (version) => version.startsWith('2.'),
        command: [resolvedBin, 'serve', '--service'],
        env: Object.fromEntries(
          Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        ),
      });
      const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
      const catalog = await client.model.list({ location: { directory: process.cwd() } }, {
        signal: AbortSignal.timeout(15_000),
      });
      return parseOpenCodeModels(catalog.data);
    },
    fallbackModels: OPENCODE_FALLBACK_MODELS,
    // V2 exposes provider/model-specific variants through model.list. The fallback
    // keeps Sol/Terra/Luna model ids usable during a catalog outage but does
    // not guess their variants. Unknown model/variant pairs omit `#variant`
    // rather than inventing a provider capability or preventing the base
    // model from running.
    //
    // Prompt delivered via stdin (`opencode run` with no message argv) to
    // avoid Windows `spawn ENAMETOOLONG` while preserving structured output.
    // A literal `-` is parsed as a positional message, not stdin.
    buildArgs: (_prompt, _imagePaths, _extra, options = {}, runtimeContext = {}) => {
      const args = [
        'run',
        '--standalone',
        '--format',
        'json',
      ];
      appendOpenCodePermissionBypass(args, 'opencode');
      // The daemon spawns with cwd set to the managed project. V2 uses cwd
      // as the active Location even when its Project is an enclosing Git root.
      // Capture-style resume: OpenCode mints its own session id (reported on
      // the stream as `sessionID`, e.g. `ses_...`). On a follow-up turn the
      // daemon continues that session with `-s <id>` instead of re-sending the
      // flattened transcript, so the first upstream call reuses the warm prefix
      // cache. `-s` continues an EXISTING session (the create turn passes no id
      // and we capture the one OpenCode generated), mirroring codex.
      const resumeSessionId =
        typeof runtimeContext.resumeSessionId === 'string' &&
        runtimeContext.resumeSessionId.length > 0
          ? runtimeContext.resumeSessionId
          : null;
      if (resumeSessionId) {
        args.push('-s', resumeSessionId);
      }
      if (options.model && options.model !== 'default') {
        const variant = supportsOpenCodeVariant(options.model, options.reasoning)
          ? `#${options.reasoning}` : '';
        args.push('-m', `${options.model}${variant}`);
      }
      return args;
    },
    promptViaStdin: true,
    // OpenCode's CLI carries its own session across spawns: on a follow-up turn
    // the daemon resumes the captured session id (`-s <id>`) instead of
    // re-flattening the transcript. Capture-style — the resume handle is the
    // `sessionID` captured from the stream, not a daemon-minted id.
    resumesSessionViaCli: true,
    capturesSessionIdFromStream: true,
    streamFormat: 'json-event-stream',
    eventParser: 'opencode',
    // OpenCode reads MCP servers from its layered config (global ~/.config
    // /opencode/opencode.json + project opencode.json + OPENCODE_CONFIG
    // + OPENCODE_CONFIG_CONTENT). The env-var form lets the daemon hand
    // user-configured external MCP servers to a single `opencode run`
    // invocation without polluting the user's saved config files. See
    // <https://opencode.ai/v2/docs/config> and issue #2142.
    externalMcpInjection: 'opencode-env-content',
} satisfies RuntimeAgentDef;
