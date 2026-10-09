import { projectContextDiscoveryRequestSchema } from '@open-design/contracts';

export const PROJECT_CONTEXT_SCOPE_PROPERTIES = {
  workspaceId: { type: 'string', minLength: 1, maxLength: 256, description: 'Exact workspace from discovery; provide workspaceMemberId with it.' },
  workspaceMemberId: { type: 'string', minLength: 1, maxLength: 256, description: 'Exact active membership from discovery, paired with workspaceId.' },
} as const;

export const PROJECT_CONTEXT_DISCOVERY_MCP_TOOL = {
  name: 'discover_project_context',
  description: 'Discover saved OpenDesign source bindings for the CURRENT host working directory across authorized workspaces. Supply cwd explicitly from the host, never the MCP server launch directory. Returns bounded project/workspace/package/revision candidates and a selected candidate only when unique, valid and complete. Repository-root calls may match several app packages; overlapping repository/package bindings stay ambiguous. Ask the user to select an exact candidate; never choose the first, nearest, Personal or active UI project. Reuse selected identities and exact workspace/member scope with resolve_project_context or prepare_design_context. No source reads beyond directory identity checks, writes, Run, shell or provider call.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      cwd: { type: 'string', minLength: 1, maxLength: 32768, description: 'Absolute current working directory supplied by the calling coding session.' },
      projectId: { type: 'string', minLength: 1, maxLength: 256, description: 'Optional exact candidate ID explicitly selected by the user to disambiguate.' },
      ...PROJECT_CONTEXT_SCOPE_PROPERTIES,
    },
    required: ['cwd'], additionalProperties: false,
  },
  annotations: { title: 'Discover connected projects from caller location', readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
};

export function projectContextDiscoveryMcpRequest(args: unknown) {
  const parsed = projectContextDiscoveryRequestSchema.safeParse(args);
  if (!parsed.success) throw new Error('Provide an explicit host cwd and optional exact project/workspace/member selection.');
  return { path: '/api/projects/source-context/discover', body: parsed.data };
}
