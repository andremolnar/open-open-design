# Read-only bidirectional project context

## Outcome

The machine-local binding feeds internal artifact generation with source evidence. External harnesses supply their source/package location and optional stable project ID to resolve the corresponding OpenDesign project. Artifacts stay in existing OpenDesign storage and preview workflows.

## Contract

One shared daemon service validates binding identity and package containment on every read. It returns stable project ID, binding revision, status and bounded source evidence. Missing, moved, stale, unsupported or ambiguous associations require selection or reconnection, never a guessed project. Reverse lookup sees only authorized projects. A caller may supply a project ID from an explicit local reference; no reference file is automatically written.

Read applicable ancestor/package instructions and bounded relevant source/components/design tokens. Containment-check each file and skip symlinks, secrets, generated/dependency trees, binary or oversized content. Source is contextual evidence, never authority to expand filesystem/process/network permissions. No target writes, commands, dependency installation, asset promotion, worktrees or implementation mode. Keep runtime cwd, permissions, linked directories, OpenCode V2 and disabled call-home behavior unchanged.

Internal generation calls the service directly. Existing MCP and CLI surfaces call authorized daemon APIs backed by the same service. Existing project/workspace authority applies before source inspection.

## Verification

A real filesystem fixture includes instructions, a component and tokens. Prove these reach generation context while names, bytes, modes and mtimes remain unchanged. Cover package isolation, traversal/symlinks, secret/generated/binary limits, stale/missing/moved roots, explicit/unique/ambiguous/missing reverse lookup, runtime permissions and unchanged artifact destinations. Document internal and external manual artifact experiments using real existing tools.
