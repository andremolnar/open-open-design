import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';

/** The npm-assembled runtime must retain the workspace's reviewed resolutions.
 * pnpm's removal selectors apply before bundling and are not npm syntax.
 * Fail on other unsupported selectors rather than silently losing policy.
 */
export async function readRuntimeNpmOverrides(workspaceRoot: string): Promise<Record<string, string>> {
  const workspace = parse(await readFile(join(workspaceRoot, 'pnpm-workspace.yaml'), 'utf8')) as {
    overrides?: unknown;
  };
  if (!workspace || typeof workspace.overrides !== 'object' || workspace.overrides === null
    || Array.isArray(workspace.overrides)) throw new Error('Workspace dependency overrides are required for packaging.');
  const overrides: Record<string, string> = {};
  for (const [selector, version] of Object.entries(workspace.overrides)) {
    if (typeof version !== 'string') throw new Error(`Invalid runtime dependency override: ${selector}`);
    if (selector.includes('>')) {
      if (version === '-') continue;
      throw new Error(`Unsupported npm runtime dependency selector: ${selector}`);
    }
    overrides[selector] = version;
  }
  return overrides;
}
