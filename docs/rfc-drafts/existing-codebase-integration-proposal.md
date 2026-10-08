# OpenDesign existing codebase integration proposal

Status: proposed design, ready for implementation planning. No application code, repository settings, branches, or dependencies were changed for this proposal.

Repository: [andremolnar/open-open-design](https://github.com/andremolnar/open-open-design), private fork. Reviewed baseline: [`644b0134f85f366a0692fe28e1de741483aa18cf`](https://github.com/andremolnar/open-open-design/commit/644b0134f85f366a0692fe28e1de741483aa18cf), checked 8 October 2026. Source links below require access to this repository.

## Recommendation

Add an explicit existing-codebase project mode that separates OpenDesign's artifact storage from the codebase the agent edits and the application the user previews. Build this on the fork's current OpenCode V2 integration, not on an older upstream adapter. Keep a folder binding as the smallest exploratory patch, but make the dual-root model the durable architecture.

Add a follow-on MCP sprint so an existing coding harness, including OpenCode, can request and retrieve project-scoped mockups, references, and moodboards without changing its implementation workspace. Extend the fork’s existing MCP server rather than assuming MCP is absent. Design assets remain logically managed by OpenDesign until the user explicitly requests their promotion into application source.

Direct edits and isolated Git worktrees should be execution choices beneath that architecture. They should not determine the storage model. The user has not selected either execution policy; the proposal remains actionable without pretending that decision has been made.

## The request expressed as a specification

A user should be able to bind an OpenDesign project to an existing local codebase, choose the application package when it is a monorepo, and ask for a design or feature. The agent should inspect and follow that project's applicable instructions, reuse its components and design tokens, respect its dependency and routing conventions, make real source changes, and show the result running in that application.

OpenDesign should continue storing its conversation, sketches, references, moodboards, palettes, textures, intermediate artifacts, and run records as its own managed design state. The default is managed storage outside the repository; an explicitly selected checkout-local Git-ignored design workspace is an alternative described below. Those artifacts should inform the implementation without becoming the application's source root or leaking into its Git history by accident.

### Required behavior

1. Bind a project to a canonical repository or source root and an optional application/package root, independently of artifact storage.
2. Show the execution destination and current mode before edits. A selected source folder must never silently mean permission to execute every script it contains.
3. Discover applicable instructions, existing components, theme/token files, aliases, framework, package manager, scripts, and relevant tests. Record evidence and freshness rather than invent a complete index.
4. Generate source files and changes appropriate to that application. Do not force a standalone HTML output contract onto a React route, component library, or other native application.
5. Use the target project's installed dependencies and configuration. Do not silently create a second application or install another framework to make a preview easier.
6. Preview the actual app through a selected, trusted command and URL/route. Preserve a separate static artifact preview where useful.
7. Preserve pre-existing user edits and untracked files. Distinguish them from changes made during a run, and never reset, clean, overwrite, or stash them automatically.
8. Bind runtime sessions, events, cancellation, output paths, and preview processes to the same immutable run identity. Switching projects in the UI must not retarget a running process.
9. Preserve standalone design projects and the fork's OpenCode V2, streaming, session, and disabled-call-home behavior.
10. Give an authorized external coding harness stable project-scoped MCP context and artifact operations. Binding, reading context, or requesting a mockup never implicitly copies design assets into application source; promotion requires an explicit user request for the selected assets and destination.

### Initial scope

Support a local repository available to the daemon, a single selected application package, source editing through the current agent runtime, and a user-approved local preview command. Begin with a fixture stack that the implementation can verify end to end, then describe supported frameworks accurately.

Out of scope for the first release: cloning arbitrary remote repositories, cloud deployment, installing credentials, automatic pull requests/merges, universal framework adapters, autonomous dependency upgrades, and a security sandbox implemented by path strings. A non-Git source folder can use direct mode if supported explicitly; worktree mode requires Git.

## Current behavior and why a folder change is insufficient

The current daemon derives the generation working directory through project resolution, then supplies an effective working directory to the agent. The OpenCode adapter launches `opencode-cli` with fallback `opencode`, using `run --standalone --format json`. It sends the prompt through stdin and resumes a captured session using `-s`. Its own comment identifies subprocess cwd as the V2 active Location, even when OpenCode's Project is an enclosing Git root. See [the current adapter](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/runtimes/defs/opencode.ts).

This baseline does **not** pass `--dir`. An implementation must set subprocess cwd explicitly and use an explicit directory/location parameter only where the selected runtime interface actually supports it. Do not add a guessed CLI flag based on an older integration. If the adapter moves to a client API, verify the directory-bearing request type in the pinned dependency and test it. CLI cwd and API location should agree whenever both apply.

The root [AGENTS.md](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/AGENTS.md) defines the daemon data-root contract: daemon-owned data derives from resolved `RUNTIME_DATA_DIR`; imported-folder projects are the stated `metadata.baseDir` exception. Extending that exception indiscriminately would mix app-owned state and user-owned source. The new design must preserve this contract or update it explicitly with the implementation.

Prompt behavior has multiple live composition paths. The fork's [prompt composition guide](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/docs/prompt-composition.md) identifies legacy slim/classic, OD Next, and daemon/contracts API/BYOK mirrors. Adding one sentence to one system prompt does not establish project integration. Use one shared project-output contract and cover every applicable path; unsupported paths should reject the new mode clearly rather than silently fall back to artifact generation.

The fork already supports imported folders; this is not a missing-folder-picker problem. `metadata.baseDir` selects the external project directory, and `ensureProject` returns that directory without creating it. File APIs, uploaded/sketched content, Design Files prompts, runtime cwd, resource staging, snapshots, and static preview still largely share that resolved project root. Managed file-version snapshots are already separate and should remain so. Linked directories are currently reference context, not explicit writable implementation targets.

A source-bound implementation run must fail closed if its target cannot be resolved. The current `effectiveCwd = cwd ?? PROJECT_ROOT` fallback must not silently launch implementation against OpenDesign's own application root. Likewise, existing Design Files prompt wording says the panel is backed by cwd; it must be changed before those roots diverge.

The existing preview route has a narrow Vite built-HTML substitution and asset rewrite. It is not evidence of general dev-server startup, SSR, or monorepo route support. The current session record is keyed by conversation and agent and includes cwd/model/cursor guards; extend those checks rather than discarding the existing protections.

Additional baseline file mapping and implementation targets appear below. These observations describe source review, not a runtime test of this fork.

## Options and tradeoffs

| Approach | Benefit | Limitation | Suitable role |
| --- | --- | --- | --- |
| Bind the existing folder as generation cwd | Smallest patch; quickly proves instruction discovery and native editing | Artifact paths, skills staging, preview assumptions, and sessions may still inherit a single-root model; easy to pollute source | Disposable, explicit opt-in spike with a fixture repository |
| Explicit artifact and source roots | Makes ownership and output behavior clear; supports direct editing and worktrees; preserves existing project types | Requires contract, orchestration, output, and UI work | Recommended foundation |
| Run in a Git worktree | Separates generated changes from the user's active checkout; enables isolated runs and review | Does not automatically include dirty/untracked source, installed dependencies, ignored environment files, or running services; needs lifecycle and integration workflow | Optional execution policy built on dual roots |
| Export a patch or implementation bundle | Minimal target-side execution; easy review and handoff | Cannot claim to have integrated or previewed the real app until applied and tested | Fallback and later review/export feature |

A folder-binding spike should not masquerade as the final architecture. Worktrees should not be presented as an automatic solution to trust, sandboxing, or dirty-state preservation.

## Reuse the existing migration machinery

The fork already contains useful implementation atoms. Refactor their root contracts rather than building a parallel repository-inspection and patch pipeline:

- [code-import.ts](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/plugins/atoms/code-import.ts#L50-L54) takes separate `repoPath` and `cwd`, reads a bounded repository tree, and writes `cwd/code/index.json`. Reuse it as a discovery foundation with artifact-root reports. The inspected runner detects frameworks from package dependencies; richer configuration and instruction evidence is proposed work. Do not promise the extra output files listed in its skill documentation when the runner only writes the index.
- [patch-edit.ts](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/plugins/atoms/patch-edit.ts#L91-L125) currently uses cwd for both plan/ownership/receipt metadata and patched source. Split report/planning root from target root while preserving atomic writes and path safety.
- [build-test.ts](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/plugins/atoms/build-test.ts#L43-L88) runs commands in cwd and writes reports under cwd/critique. Separate execution cwd from report root. Current inference prefers typecheck before build, detects pnpm/yarn with npm fallback, and executes through `sh -c`; it does not establish universal monorepo, Bun, or native Windows support. Report the actual command run rather than calling typecheck a production build.
- [diff-review.ts](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/plugins/atoms/diff-review.ts#L61-L79) consumes cwd/plan and writes cwd/review outputs. Those review artifacts belong in managed artifact storage.
- The existing [od-code-migration scenario](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/plugins/_official/scenarios/od-code-migration/SKILL.md) chains import, token extraction, rewrite planning, patch/build-test iteration, diff review, and handoff. Reuse its composable steps where they fit. Its existence does not prove that ordinary design chat already has dual-root execution or native app preview.

## Proposed domain model

The following names are proposed internal concepts, not existing APIs or confirmed schema fields. Adapt the final shape to the repository's current storage and contract boundaries.

### Project binding

Persist a versioned project binding containing:

- Stable OpenDesign project ID and binding revision. A project name or display hash is a label; the opaque ID is the durable reference used by MCP and the UI.
- Artifact-storage reference: daemon-managed storage by default, or an explicitly selected checkout-local ignored design workspace. Resolve both server-side through the versioned binding; any new local-storage exception must be documented in the daemon data-root contract.
- Canonical source repository/root identity plus a display path.
- Application/package path relative to that source root. This may differ from the repository root and from the package-manager workspace root.
- Execution mode: direct or worktree; explicit unset state until chosen.
- Selected preview and validation configuration, including command cwd and route, with a trust revision.
- Mode-specific metadata, such as the worktree's repository association. Avoid relying on a remote URL alone as a unique local repository identity.

Do not persist machine-specific absolute paths as universally portable project identities. A moved or missing checkout needs an explicit rebind flow; a project must never silently attach to an unrelated directory at an old path.

### Artifact location and Git ownership

Keep three decisions distinct: physical filesystem location, Git tracking, and logical ownership. Exploratory mockups, references, moodboards, palettes, and textures remain OpenDesign-managed artifacts whether stored outside the checkout or in a dedicated ignored folder inside it. Co-location does not make them application source or authorize promotion. Keep daemon credentials and unrelated global state in the daemon’s managed data root.

The default external location avoids source-tree pollution. An optional checkout-local ignored folder can make design material easier to inspect beside the code, but requires explicit location selection and a preflight collision check. Reuse an existing ignore rule where appropriate; otherwise show the exact proposed `.gitignore` or local-exclude change for approval. Do not overwrite an existing directory, automatically untrack already tracked files, or assume adding an ignore entry removes files from Git. Verify the actual tracking/ignore state, including inherited rules and force-added files, and report conflicts before use.

Git ignore is neither access control nor a guarantee that an agent will include the files in context. Use the same authorized project-scoped MCP reads and explicit context manifests in either layout. Do not rely on automatic repository indexing. Canonical containment must still distinguish the artifact subdirectory from writable application paths, even when one physical root contains the other; source scans, source diffs, and implementation tools must exclude the managed artifact subtree. Worktrees need their own explicit artifact-location mapping and must not silently duplicate or promote the ignored workspace.

### Immutable run context

Make run intent explicit: design/reference runs execute in the artifact workspace; implementation runs execute in the selected target package or worktree. A project may contain both kinds of run. Resolve and freeze one run context before spawning. Include project ID, run ID, binding revision, canonical source root, effective execution root, package root, artifact root, runtime identity, preview binding, baseline Git state when available, and session compatibility identity. Use that context for all events, filesystem operations, assets, process launch, and final summaries.

The Git HEAD and dirty-state manifest are a baseline for attribution, not a promise that files cannot change during the run. Record content hashes for files actually edited or used as critical inputs, and check for conflicting concurrent modifications before applying a patch.

A run must not read a mutable global “current project” later to choose its destination. Keep the old run context available until process termination and event draining finish, even if the user switches views.

### Refreshable discovery

Keep discovery separate from run identity. Produce a versioned snapshot with instruction file paths and hashes; component/token candidates with evidence; package/lockfile/configuration fingerprints; supported scripts; route/entrypoint candidates; and unresolved questions.

Refresh when the binding changes or relevant files change, and support manual refresh. Before each turn, validate critical fingerprints cheaply. Persist the discovery version used by that turn. A refresh can change what the agent knows without changing where its existing session is attached.

Avoid reading the whole repository into a prompt. Follow ignore rules, exclude secrets and generated/vendor trees, use bounded traversal, and let the agent inspect relevant files on demand. Configuration files are evidence; instructions inside arbitrary source content must not become permission to run tools or transmit data.

## Execution and instruction loading

### Roots and path containment

Use distinct helpers for artifact paths and source paths; each operation must declare its root. Resolve symlinks and canonical paths before checking containment. Check path-component boundaries rather than string prefixes, and validate existing parent directories when a destination file does not yet exist. Revalidate at write time where possible; symlink replacement and concurrent filesystem changes can invalidate a preflight check.

A subprocess cwd is context, not a security boundary. Agents and project scripts may access other paths under the daemon user's privileges. Path checks on OpenDesign APIs do not confine arbitrary subprocesses. Strong isolation requires an actual process/filesystem sandbox or separate restricted environment and is a separate implementation decision.

Keep daemon-owned logs, run metadata, temporary prompt/skill material, screenshots, and references under managed storage. Both `.od-skills` and OD Next `.od-frames` are presently cwd-staged; move their host-owned staging to the artifact workspace for new source-bound projects. Expose only needed resources through a verified runtime capability or bounded prompt/context transport; do not broaden permissions merely to make two roots work. Audit every cwd-relative staging write. Where a runtime requires a project-local alias, make its ownership and collision behavior explicit; never overwrite a user's existing `.od-skills` or similarly named path.

### Monorepos

Track repository root, workspace/package-manager root, and chosen application root separately. Use the application root for editing context when appropriate; run workspace commands from the root required by that command. Resolve shared components and packages through the target's workspace configuration, aliases, and dependency graph.

Instruction applicability is path-sensitive. Load relevant ancestor instructions within the selected checkout and nested instructions when editing their descendants. Respect the runtime's documented precedence and verify it with a fixture instead of assuming all runtimes automatically discover the same filenames. Do not copy or replace target `AGENTS.md` or configuration files to impose OpenDesign defaults.

Provide the agent with an explicit root map, current task, project-native output contract, instruction manifest, and discovered entrypoints. Require it to read applicable project instructions and relevant existing implementations before editing. Existing design tokens and component APIs take priority over generic visual templates unless the user explicitly asks to change them.

### OpenCode V2 and session correctness

Preserve the adapter's stdin transport, JSON event parsing, model/variant handling, `--standalone`, and captured-session resume. Pass the intended effective execution root as the actual spawn cwd. Add a fixture whose repository and package roots differ so a passing test proves the active Location rather than merely proving a string was placed in a prompt.

Associate a captured runtime session with runtime/backend identity, project binding revision, canonical execution root, package selection, and output mode. Resume only compatible sessions. Rebinding, switching direct/worktree mode, selecting another package where context is incompatible, or changing execution roots must create a fresh session or explicitly restart with a reconciled context. Never “resume successfully” into the old checkout after a UI switch.

For discovery-only changes, refresh the context of a compatible session and record the new discovery version. If a runtime cannot safely refresh its instruction context, restart the session and explain why.

Serialize mutation runs sharing a canonical execution root in the first implementation. Separate worktrees may run concurrently if all run-owned resources are isolated. Key process registries, SSE/event routing, cancellation, and preview ownership by run ID and binding identity. A late event from one project must never update another project's files or preview.

## Project native output and assets

Treat standalone artifact generation and source integration as explicit output modes. Preserve standalone behavior for current projects. In source mode, success is an inspectable source diff plus validation evidence and an app preview, not the existence of a generated HTML file.

Keep the design brief, exploratory sketches, mockups, screenshots, references, moodboards, palettes, textures, and review notes in the OpenDesign-managed artifact workspace. This remains true for the optional checkout-local ignored layout. A repository binding, a context read, a mockup request, or an implementation request does not by itself authorize copying these assets into application source.

Promote assets only when the user explicitly asks. Resolve the exact artifact IDs and versions, proposed destination paths, repository/package binding, and any reference updates in a reviewable promotion plan. If the request leaves those details ambiguous, ask before copying. A client-supplied `approved: true` is not proof of consent. Bind the confirmed plan to the actual user action, current binding revision, artifact content hashes, destination state, and collision policy; changed content or destinations need renewed review. Do not silently overwrite target-owned files or bulk-promote a moodboard’s supporting assets.

After authorized promotion, copy only the selected assets into deliberate target-owned locations using the project’s conventions, and update only approved references. A shipped source file must not depend on an absolute local artifact path, an OpenDesign-only serving endpoint, a temporary blob URL, or a file available only in an ignored design workspace. If implementation needs an unapproved design asset, keep the design exploratory and request promotion rather than sneaking it into source.

Record an asset provenance and destination manifest, including artifact ID/version/hash and the promotion authorization. Avoid collisions, duplicates, and overwrites; account for bundler imports versus public URLs, base paths, MIME types, and licenses where relevant. A clean checkout plus declared dependencies and explicitly promoted assets should build without the OpenDesign daemon or its exploratory workspace.

## MCP sprint for an existing coding harness

### Verified baseline and intended extension

The reviewed fork already implements [`od mcp` in `apps/daemon/src/mcp.ts`](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/mcp.ts): a stdio server that proxies daemon APIs for coding agents working in another repository. Existing tools include `list_projects`, `get_project`, `list_files`, `get_file`, `search_files`, `get_artifact`, `create_artifact`, `start_run`, `get_run`, and `cancel_run`. `start_run` already commissions generation and returns a run ID; `get_run` returns durable artifact references and current preview/Studio links. Some current tools can fall back to the active UI project when a project is omitted. That convenience is unsuitable for the proposed repository-bound workflow.

The fork also has [agent registration planning including OpenCode](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/mcp-agent-install.ts), [workspace-aware MCP request headers](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/mcp-workspace-context.ts), and a [separate live-artifacts MCP surface](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/mcp-live-artifacts-server.ts). These are source-level findings, not an executed interoperability test. The sprint extends these contracts and reuses daemon services; it does not introduce a second competing server or claim that existing authentication already enforces all proposed capabilities.

The intended workflow is: keep implementing in an existing OpenCode or other supported harness; select an OpenDesign project by stable ID linked to a particular repository/package; ask OpenDesign for a mockup, references, or moodboard; inspect the results and context through MCP; then continue implementation in the harness. A generated mockup stays in the managed artifact workspace. Only a separate explicit asset-promotion request can copy selected assets into application source.

### Resolve the project from repository context

When a harness invokes MCP from a repository, first resolve which OpenDesign project belongs to that repository and selected package. Use a verified existing binding; do not guess from a repository name, matching project title, remote URL alone, or the project currently open in the UI. If no binding exists or several projects/packages match, return a selection-required result and ask the user to choose or clarify before any project-scoped read, generation, or mutation. Scoped catalog discovery may help present the choices without exposing another project’s artifacts.

Offer an explicit durable binding: a small repository-local configuration/reference containing the stable OpenDesign project ID and optional package selection, or an external mapping maintained by OpenDesign. The exact filename and schema are proposed implementation details. Let the user choose the location and whether a repository-local reference is tracked or ignored; do not write a config file, alter ignore rules, or add it to Git merely because the harness connected. A tracked reference must contain no credentials or machine-specific absolute paths and must remain subject to access checks for each collaborator. An external mapping must distinguish local checkouts and package selections without depending on a mutable display name.

Treat a checked-in reference as a lookup hint, not a grant. Verify the authenticated workspace, project access, canonical checkout/package, and server-side binding revision before accepting it. Missing projects, moved checkouts, stale references, or mismatches require repair or explicit rebind; never silently attach another project. Once resolved, freeze the project ID and revision for the harness session and every child run. Creating or repairing this binding grants no asset-promotion permission.

### Proposed tool contracts

Names and fields below are proposed interface shapes, not claims about existing tool signatures. Prefer compatible extensions or scoped adapters over duplicate tools. Publish a contract version and advertise supported capabilities so older clients fail clearly when a capability is unavailable.

| Proposed operation | Inputs and result | Authority and effects |
| --- | --- | --- |
| `resolve_project_binding` | Verified repository/session context and optional selected package; return bound project ID/revision or selection-required/stale-binding result | Proposed read-only resolver; caller-supplied paths are hints, never authority. Persisting a choice is a separate explicit binding action |
| Extend `list_projects` and `get_project` | Return stable project ID, accessible binding summary, selected package, binding revision, and capabilities; retain bounded results | Read only within the authorized workspace/project scope; discovery does not create a binding |
| `get_project_context` | Required project ID and expected binding revision; return bounded brief, reference/moodboard metadata, repository/package identity, instruction/discovery versions, and artifact references | Read context; exclude secrets and unrelated repository files; no filesystem or source mutation |
| Extend `list_files`, `get_file`, `search_files`, and `get_artifact` | Required explicit project ID for bound sessions; artifact ID/version or contained artifact-relative path, pagination and byte limits | Read managed artifacts, never arbitrary client filesystem paths; binary assets return authorized resources/preview references rather than pretending to be text |
| Extend `get_run` and artifact preview lookup | Project ID plus run/artifact ID; return status, durable artifact identity, current authorized preview URI, and terminal failure details | Read status/preview; reading a preview does not launch an application script or approve promotion |
| Extend `start_run` for design requests | Project ID, binding revision, kind such as mockup/reference/moodboard, brief, selected context references, and stable request ID; return run ID and status | Requires `artifacts:generate`; writes only managed artifacts and run records, with explicit artifact-only intent regardless of the code binding |
| `plan_asset_promotion` and `promote_assets` | Exact artifact IDs/versions/hashes, bound repository/package, contained destination-relative paths, conflict policy, and server-issued plan/authorization reference | Planning returns a diff without source writes. Execution requires a separately confirmed user request and `source:promote`; copies only the approved assets and approved reference edits |

`resolve_project_binding`, `get_project_context`, `plan_asset_promotion`, and `promote_assets` are proposed additions. Generation kinds should map to supported skills/services after capability discovery; do not advertise a moodboard or reference mode as implemented until its full path is tested. Existing generic write/delete tools must not bypass the artifact/source separation. Keep read-only MCP annotations accurate, but enforce authorization server-side rather than treating annotations as security boundaries.

### Identity and capability boundaries

Use a server-side binding from stable project ID to canonical repository identity, selected relative package, artifact-storage reference, and binding revision. Repository names, remote URLs, display hashes, cwd strings, and UI selection alone are insufficient authorization. The trusted binding flow resolves paths once and validates them again for each operation; MCP callers cannot substitute an arbitrary absolute path or silently rebind a project.

Bind each external harness session to authenticated principal/workspace, allowed project IDs, binding revision, and explicit capabilities. Separate at least `context:read`, `artifacts:read`, `artifacts:generate`, and `source:promote`. Default discovery and context use must not grant generation or source writes. Project IDs are identifiers, not secrets or credentials. Reuse the existing transport and authentication mechanisms where suitable, audit the actual daemon authorization boundary, and add scoped grants or session enforcement where necessary. Localhost or stdio transport alone is not proof of authorization. New persistent access needs explicit setup approval; never commit credentials or silently rewrite the harness configuration.

Reject missing, stale, revoked, cross-workspace, or mismatched project bindings for this workflow. Never fall back to the current UI project or another workspace. A UI project switch must not retarget an in-flight MCP run, and rebind must invalidate or deliberately refresh incompatible sessions. Authorize run polling, cancellation, resource reads, and preview URLs against the same project/run identity. Return bounded context and avoid exposing canonical host paths where an opaque reference suffices.

Preserve the existing stable request-ID semantics for generation retries. Scope deduplication to the authorized project and operation; reject changed payloads under the same request ID. Record parent harness/session and child run identity, propagate cancellation only to the owned run, and prevent an OpenDesign generation from recursively commissioning unbounded MCP generations. Define terminal states and retrievable failure evidence so a disconnected harness can reconnect without duplicating work.

## Preview and validation

Add an application-preview path alongside the existing artifact preview. Discover candidate scripts but let the user approve the exact executable, arguments, working directory, environment requirements, and network exposure before first execution or material changes. Reading `package.json` does not make its scripts trusted.

Use process argument arrays rather than interpolating untrusted text into a shell. Some legitimate scripts need a shell; surface and contain that choice. Do not expose environment values in logs or automatically copy ignored `.env` files into a worktree.

A preview record should own its run/binding identity, command, cwd, process handle, allocated port/origin, readiness check, selected app route, and termination policy. Detect port collisions. Do not terminate a user's existing server unless it was explicitly adopted with permission. Stop only processes owned by the relevant run or preview lease.

Verify readiness with a real response and route, then display the actual app URL. Support HMR when the app does. If embedding is blocked by CSP, frame headers, authentication, or cross-origin restrictions, provide an external preview link; do not weaken application security headers to force an iframe.

Validation should use the target's existing checks and affected-package commands. Capture command, cwd, exit status, and concise output. Report pre-existing failures separately from newly introduced ones; no available test command means “not validated,” not “passed.” A screenshot is useful evidence of rendering but is not evidence of type correctness or safe source integration.

## Dirty files and worktree semantics

Direct mode should show pre-existing changes, record the starting state, and make narrow edits. Do not run `git reset`, `git clean`, checkout-overwrite, or automatic stash/pop as recovery. A run diff must distinguish pre-existing state from changes attributed to the run; a final `git diff` alone cannot do that reliably. If another editor changes a touched file, reconcile or stop rather than overwrite it.

Worktree mode should default to a documented committed base. Dirty and untracked files in the user's active checkout are not automatically present. If the user wants them included, offer a reviewed, explicit transfer strategy and report exclusions, including ignored secrets and local dependencies. Never claim that a worktree is an exact copy of the current workspace.

Keep an owned worktree until the user has reviewed and integrated or discarded its changes. Do not automatically delete it on cancellation or failed preview. Integration back into the original checkout must be a separate reviewed operation with conflict checks; creating a branch does not authorize committing, merging, or pushing.

## Migration and compatibility

Introduce a versioned optional binding. Existing projects without one continue in the legacy standalone mode using current resolution. Do not infer that every imported-folder project wants native source generation: an imported folder may contain design artifacts rather than an application.

Provide an explicit convert/bind action with a preflight summary. Preserve old artifact paths, conversations, and project IDs. Do not relocate user files or rewrite old outputs as part of the schema migration. Invalidate incompatible runtime-session associations when the binding changes, while keeping the conversation readable.

Use a capability gate during rollout. The server must validate mode support independently of the UI. Old clients should still open legacy projects; if they cannot safely operate on a source-bound project, fail clearly instead of reverting to a dangerous single-root interpretation. Rollback should disable new runs while preserving binding records and generated source for recovery.

## Source inventory and change map

All links pin the reviewed commit. New modules mentioned in the plan are proposals.

| Existing source | Relevance and intended change |
| --- | --- |
| [projects.ts](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/projects.ts#L87-L163) | External `baseDir` and project files; separate artifact access from target binding without changing legacy imported-folder semantics |
| [import-export-routes.ts](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/import-export-routes.ts#L190-L198) and [project routes](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/routes/project/index.ts#L3875-L3905) | Use explicit trusted selection/binding routes; preserve privileged metadata protections rather than permitting arbitrary root changes |
| [server.ts generation root resolution](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/server.ts#L11149-L11188) and [cwd fallback](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/server.ts#L11582-L11604) | Wire one typed run context; fail closed for a missing implementation target; keep domain logic in extracted modules |
| [chat-prompt-inputs.ts](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/runtimes/chat-prompt-inputs.ts#L857-L885) | Replace the Design Files equals cwd assumption with explicit artifact and source-output contracts |
| [cwd-aliases.ts](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/cwd-aliases.ts) and [resource staging wiring](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/server.ts#L11508-L11579) | Relocate source-mode host resources without overwriting target-owned paths |
| [db.ts session schema](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/db.ts#L209-L235) and [agent-session-resume.ts](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/agent-session-resume.ts#L194-L266) | Persist and compare binding/mode/package compatibility in addition to existing safeguards |
| [run-artifact-fs.ts](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/run-artifact-fs.ts#L26-L98) | Keep supported artifact reconciliation; add a distinct source-change outcome rather than treating snapshots as a universal Git tracker |
| [project-file-versions.ts](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/project-file-versions.ts#L90-L100) | Preserve managed version storage independently of target source |
| [project-watchers.ts](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/project-watchers.ts#L171-L203) | Separate artifact changes and bounded target discovery invalidation; preserve ignores, no-symlink traversal, subscriber refcounts and polling fallback |
| [project preview heuristic](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/routes/project/index.ts#L6463-L6500) | Keep static artifact serving and add a distinct application-preview contract |
| [OpenCode permissions](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/src/runtimes/opencode-permissions.ts) | Preserve V2 capability-gating and explicit denies; no blanket permission workaround |
| [no-call-home.test.ts](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/tests/no-call-home.test.ts) | Preserve detached-build network behavior from the latest fork commit |

Instruction discovery needs a dedicated, bounded read policy. Current project-file operations reject hidden path segments; do not weaken their general serving policy merely to inspect scoped instruction/configuration files.

Shared DTOs belong in `packages/contracts` without Node/fs/process dependencies. Follow `apps/daemon/AGENTS.md` domain ownership. New capabilities need API/web and `od` CLI parity; the binding, inspection, mode selection, and preview controls should have equivalent validated command paths. Identify exact UI/CLI call sites during PR 1 instead of inventing existing component or command names here.

## Implementation plan

The ordered pull requests below are proposed. Exact new filenames are suggestions; existing targets are pinned in the source inventory. Each PR should start with a failing behavioral test and preserve the fork's existing fixes.

### PR 1 Establish root contracts and migration

Existing targets: `apps/daemon/src/projects.ts`, `import-export-routes.ts`, `routes/project/index.ts`, `db.ts`, and `server.ts`; shared binding DTOs in `packages/contracts`. Extend `apps/daemon/tests/folder-import-projects.test.ts`, `projects-list-files.test.ts`, and `project-file-versions.test.ts`. Add dedicated root-resolution tests.

Add a shared versioned binding and immutable run-context type; implement canonical-root resolution, package selection, and explicit legacy fallback. Keep source integration behind a capability flag. Extract the root-resolution seam from generation orchestration rather than adding more unrelated branches to the large server file.

Tests: legacy project migration; missing source root; rebind revision; package outside repository; symlink escape; path-prefix confusion; nonexistent file parent; worktree/source identity mismatch.

Acceptance: a standalone project behaves identically; a source-bound fixture resolves distinct artifact, repository, package, and execution roots; no source writes occur merely from binding.

### PR 2 Discover project context and compose all prompt paths

Existing targets: `apps/daemon/src/runtimes/chat-prompt-inputs.ts`, `apps/daemon/src/prompts/system.ts`, `core-slim.ts`, legacy prompt modules, `packages/contracts/src/prompts/system.ts`, `od-next-strategy.ts`, and applicable `plugins/_official/scenarios/od-next-strategy/` assets/manifest. Extend daemon prompt tests and contracts `system-prompt.test.ts` and `od-next-prompt-recipe.test.ts`; do not rely only on the legacy matrix.

Extend `apps/daemon/src/plugins/atoms/code-import.ts` and its existing `apps/daemon/tests/plugins-code-import.test.ts` coverage. Add bounded discovery with evidence/fingerprints and a shared source-output directive. Wire it into daemon legacy slim/classic, OD Next recipes, and applicable contracts/API paths. Explicitly reject unsupported source mode where execution capabilities are absent. Preserve host contracts for standalone artifacts.

Tests: nested instructions; monorepo workspace/package distinction; existing component and CSS-token discovery; stale configuration refresh; secret/vendor exclusion; prompt parity across all actual strategy variants.

Acceptance: the fixture's existing component and token names are grounded in source, and every supported prompt path receives the same root and output contract. No project instruction file is overwritten.

### PR 3 Bind runtime execution and sessions

Existing targets: `apps/daemon/src/server.ts`, `runtimes/defs/opencode.ts`, `agent-session-resume.ts`, `db.ts`, `cwd-aliases.ts`, and runtime invocation wiring. Extend `apps/daemon/tests/agent-session-resume.test.ts`, `db-agent-sessions.test.ts`, `opencode-session-resume.test.ts`, and runtime `opencode-resume-args.test.ts`, `agent-args.test.ts`, `byok-opencode.test.ts`, `json-event-stream.test.ts`, and `opencode-event-plugin.test.ts`.

Pass run-context cwd through the existing spawn path. Keep OpenCode V2 flags and stdin behavior. Implement session compatibility checks, same-root mutation serialization, and run-scoped event/cancellation handling. Audit skills and temporary-file staging for accidental source pollution.

Tests: captured-session reuse for the same binding; fresh session after rebind or incompatible package/mode change; delayed events after project switching; cancellation targeting; two same-root runs; explicit active Location in a monorepo; user-owned staging-path collision.

Acceptance: a fixture change lands only in the selected execution root, and switching projects during generation cannot redirect writes, sessions, or events. Existing OpenCode stream/model/resume tests remain green.

### PR 4 Support native outputs and explicit asset promotion

Existing targets: `apps/daemon/src/run-artifact-fs.ts`, `projects.ts`, `routes/project/index.ts`, `project-file-versions.ts`, `project-watchers.ts`, and generation reconciliation wiring. Extend `apps/daemon/tests/project-upload-subdir-path.test.ts`, `project-watchers.test.ts`, and `project-file-versions.test.ts`; add source-change and asset-portability fixtures.

Refactor `apps/daemon/src/plugins/atoms/patch-edit.ts`, `diff-review.ts`, and the planning/report interfaces to separate target and report roots. Extend `apps/daemon/tests/plugins-patch-edit.test.ts`, `plugins-patch-edit-atomic.test.ts`, `plugins-diff-review.test.ts`, `plugins-diff-review-genui-bridge.test.ts`, and `plugins-rewrite-plan.test.ts`. Make output recognition mode-aware. Source mode reports changed files, baseline/run diff attribution, imported assets, and validation status. Keep artifact outputs as separate records. Add a narrow, explicitly authorized asset-promotion service with reviewed asset versions/destinations, collision checks, and containment checks. Support the external default and explicitly selected checkout-local ignored artifact layout without confusing co-location with source ownership.

Tests: no source asset copy on binding, context read, or mockup generation; ignored local artifact layout and already-tracked conflicts; stale promotion approval and changed artifact version; source run with no standalone HTML; explicitly approved React/bundler asset import; public asset URL/base path; duplicate name; asset traversal; unchanged pre-existing dirty file; concurrent modification conflict.

Acceptance: source fixture builds without the daemon's artifact-serving endpoint or ignored design workspace; only explicitly approved assets appear in application source, and the final change report distinguishes the user's original edits from run changes.

### PR 5 Preview the actual application

Existing targets: `apps/daemon/src/routes/project/index.ts` plus a proposed separate preview-lifecycle module; extend shared DTOs and the actual web preview consumers after tracing their current call sites. Extend `apps/daemon/tests/project-preview-containment.test.ts` and `project-raw-cache.test.ts` to prove static behavior remains intact; add process-lifecycle and native-app preview tests.

Refactor `apps/daemon/src/plugins/atoms/build-test.ts` and extend `apps/daemon/tests/plugins-build-test.test.ts` so command cwd and report root are distinct and actual checks are labeled correctly. Add preview configuration and trust UI; implement owned-process launch, readiness, route selection, logs, and cleanup. Expose application preview alongside artifact preview, with external-browser fallback.

Tests: correct command cwd; script trust revision; port collision; timeout; missing environment; frame-restricted app; project switch while preview starts; stopping one run leaves another and user-owned processes intact.

Acceptance: a visible change uses the fixture's real component and tokens and appears at its native route through its existing build/dev configuration. Failure is actionable and does not silently substitute a standalone mockup.

### PR 6 Complete review and execution policy

Existing targets: bound-project API/web/CLI surfaces, session/root-resolution modules, `e2e` production-boundary fixtures, `AGENTS.md` data contract if a change is needed, and `docs/prompt-composition.md`. Extend `apps/daemon/tests/no-call-home.test.ts` if new network-capable preview/discovery paths affect its guarantees.

Ship the selected initial execution mode, user-visible diff/review flow, rebind/recovery UI, documentation, and end-to-end smoke coverage. If worktrees are selected, add creation, dirty-state selection, dependency/environment preflight, owned-resource lifecycle, and explicit integration-back behavior. If direct mode ships first, keep worktree-specific schema extensibility without claiming worktree support.

Acceptance: complete steps 1–10 of the end-to-end scenario below in the actual daemon/UI boundary; demonstrate legacy project compatibility and disabled-call-home regression coverage. No automatic commit, push, or source reset occurs.

### PR 7 Extend MCP for repository bound design context

Dependencies: PR 1 establishes stable binding and canonical roots; PR 2 supplies bounded context; PR 3 supplies session/run identity; PR 4 supplies artifact ownership and explicit promotion. Reuse PR 5 preview services where an application preview is requested. Ship this follow-on sprint after the six-stage foundation; interface design and read-only contract fixtures can begin once PR 1 is stable.

Existing targets: `apps/daemon/src/mcp.ts`, `mcp-workspace-context.ts`, `mcp-agent-install.ts`, and daemon project/run/artifact services. Consider `mcp-live-artifacts-server.ts` only where its existing live-artifact contract applies; do not conflate that surface with general design-file access. Extend `apps/daemon/tests/mcp-workspace-projects.test.ts`, and add contract, capability, binding-isolation, and real harness interoperability fixtures. Trace the actual registration/configuration flow before changing it; preserve the fork’s OpenCode V2 schema and detached-network constraints.

Implement the scoped contracts above, explicit project selection, artifact-only design commissioning, bounded context/resources, versioned capabilities, and separate promotion planning/authorization. Reuse existing `start_run`/`get_run` and request-ID behavior, with project-bound result and cancellation checks. Provide API/CLI parity and setup documentation, including the difference between read access, managed artifact generation, and source promotion. Do not silently install MCP configuration or broaden a saved grant.

Tests: repository context resolves a verified binding; missing or ambiguous mapping requires user selection before project-scoped operations; tracked/ignored local reference and external mapping; moved checkout and stale reference; binding never grants promotion; external OpenCode session requests a mockup and moodboard for the selected project; context and preview retrieval; two repositories with similarly named projects; missing/stale binding; UI project switch; cross-workspace artifact/run access; revoked capability; traversal and symlink escape; no arbitrary absolute-path reads/writes; retries without duplicate generations; cancellation isolation; artifact version change before promotion; generation cannot invoke promotion; both artifact-storage layouts; no recursive generation loop.

Acceptance: from an already-running coding harness in repository A, resolve the verified stable OpenDesign project bound to A’s package; with a missing or ambiguous mapping, ask the user to select and explicitly choose local-reference tracking/location or external mapping before proceeding. Then list/read its design context, commission and preview a mockup plus moodboard, and continue using those references without copying any exploratory assets into source. Switching the UI to project B cannot redirect that workflow. Then explicitly request promotion of one versioned asset to one reviewed package-relative destination: only that approved copy and approved reference edits occur. Repeat the no-promotion checks with the checkout-local ignored layout, and verify existing standalone MCP clients remain compatible.

### Verification commands and baseline caution

Follow the repository's Node 24 and pinned pnpm guidance. Use `pnpm guard`, `pnpm typecheck`, and package-scoped commands such as `pnpm --filter @open-design/daemon test` and `pnpm --filter @open-design/web test`; run the selected contracts and e2e suites using their documented package commands. Do not add a root aggregate test/build alias or substitute an invented lifecycle command for `pnpm tools-dev`.

Source inspection found a pre-existing-looking expectation mismatch in [opencode-resume-args.test.ts](https://github.com/andremolnar/open-open-design/blob/644b0134f85f366a0692fe28e1de741483aa18cf/apps/daemon/tests/runtimes/opencode-resume-args.test.ts): two cases expect arguments beginning `run --format json`, while the production V2 adapter begins `run --standalone --format json`. This was not executed, so it is not a confirmed runtime failure. Establish the test baseline and reconcile stale expectations before claiming the integration causes or fixes a regression. Preserve `--standalone` unless actual V2 compatibility evidence warrants a separate change.

## End to end acceptance scenario

Use a fixture monorepo with a root instruction file, package-specific instructions, an existing shared button component, CSS design tokens, a package-manager lockfile, an application route, one tracked dirty file, and one untracked user file. Test the default managed artifact location outside the fixture codebase, then repeat the artifact-ownership checks with an explicitly selected checkout-local Git-ignored folder.

1. Bind the application package and choose direct or worktree mode explicitly.
2. Ask for a UI change using the existing design system.
3. Verify the agent reads applicable instructions and reuses the actual component/token APIs.
4. Verify the resulting source is in the selected execution root, with no unintended OpenDesign support files in the source tree.
5. Verify the user's starting changes survive. For worktrees, verify the declared dirty-state transfer policy rather than assuming those changes were copied.
6. Launch the approved existing app command from the correct root and load the changed route.
7. Run relevant target checks and inspect asset portability. Verify exploratory moodboards, palettes, textures, and references have not been copied into application source. Promote a selected asset only after an explicit request approving its version and destination.
8. Follow up in the same session, then switch or rebind and verify session isolation and late-event handling.
9. Cancel or fail a run and verify recoverability, process ownership, and preserved source changes.
10. Open an old standalone design project and confirm its generation, artifact preview, and resume behavior still work.
11. Complete the PR 7 external-harness scenario using the stable project ID, with separate read, managed-generation, and promotion permissions; verify both artifact-storage layouts and project-switch isolation.

## Decisions before implementation

- Which execution mode should be the first user-facing default: direct editing or an isolated worktree? Recommendation: choose explicitly in onboarding; use worktrees when isolation is worth their environment/setup cost, and direct mode where preserving the current working state is essential.
- Which concrete target stack/package is the first acceptance fixture? Start narrow enough to validate native routing, components, tokens, assets, and preview honestly.
- What command trust and filesystem isolation guarantees will the product make? Document actual guarantees; cwd and worktrees are not sandboxes.
- Must API/BYOK support source mode in the first release? If not, make its unavailability explicit and tested, while keeping shared contracts consistent.

These are implementation decisions, not blockers to the architectural specification. The immediate next step is a root-contract PR plus a failing monorepo fixture proving the desired behavior, followed by the runtime and prompt work above, then the repository-bound MCP sprint. This proposal authorizes no application implementation or runtime configuration changes.
