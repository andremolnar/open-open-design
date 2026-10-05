import { agentCapabilities } from './capabilities.js';
import type { RuntimeAgentDef } from './types.js';

export const OPENCODE_AUTO_APPROVE_FLAG = '--auto';

export const OPENCODE_PERMISSION_CAPABILITY = {
  helpArgs: ['run', '--help'],
  capabilityFlags: {
    [OPENCODE_AUTO_APPROVE_FLAG]: 'skipPermissions',
  },
} satisfies Pick<RuntimeAgentDef, 'helpArgs' | 'capabilityFlags'>;

export function appendOpenCodePermissionBypass(args: string[], agentId: string): void {
  if (agentCapabilities.get(agentId)?.skipPermissions) {
    // V2 auto-approves requests that are not explicitly denied. Never undo a
    // configured deny in an unattended OpenDesign run.
    args.push(OPENCODE_AUTO_APPROVE_FLAG);
  }
}
