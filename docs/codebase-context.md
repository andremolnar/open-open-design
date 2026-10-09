# Use a connected codebase as design context

A project connection keeps two places separate: **Connected source** is read-only reference material; **Design storage** continues to own generated artifacts. Source context is available to the internal chat and to an external harness through the existing OpenDesign MCP server. No dependencies are installed in the connected source, and no scripts or builds are run there.

Connect an existing source folder through **Connect codebase…** in the project menu. For a monorepo, select the specific app/package too. The existing project ID and design files remain unchanged. Machine-local connections do not travel in exports or project copies.

## First internal experiment

1. Use a small disposable source repository with a component, a stylesheet containing distinctive design tokens, and a short `AGENTS.md` describing a visible design convention. A nested app/package is useful for testing monorepo isolation.
2. Record the source checkout's current tracked diff and untracked files. Connect it to an existing OpenDesign project, optionally selecting the app/package. Do not import the source as design storage.
3. Ask in that project's chat: “Create a small HTML mockup for the connected app. Reuse the visible conventions, component shapes and design tokens in the supplied source evidence. Cite which source files informed the design. Save the mockup in this project's Design Files.”
4. Open the generated artifact in the existing preview. Check that it reflects the actual component/tokens rather than an invented framework. Source evidence is bounded, so the answer should disclose omitted context rather than claim the entire repository was inspected.
5. Confirm the new artifact is in Design Files and the source checkout has no changes. Quit/reopen the app and repeat a refinement.
6. Move the source directory and try again. The connection should report that it is unavailable, and the missing path must not be recreated. Reconnect explicitly before expecting source-grounded generation.

The automated source-context and runtime tests use real temporary source trees and compare names, bytes, permissions and modification times before/after reads and generation. The agent in the runtime fixture is deterministic; a live model's visual quality still needs the manual experiment above.

## External harness experiment

Use the existing configured OpenDesign MCP connection. These tools do not create a second MCP server or require a new source-side daemon.

1. Call `resolve_project_context` with the absolute connected `sourceRoot` and the selected `appRelativePath` (omit the latter for a root binding). Supply `projectId` if the harness already has an explicit stable project reference.
2. Continue only when the response is `ready`. Keep the returned stable `projectId`. If several projects match, ask the user to select one and repeat with that ID. Missing, stale or moved bindings need selection/reconnection; do not substitute the currently active project or a similarly named project.
3. Read `get_project_source_context` with that explicit `projectId` if fresh evidence is needed. Use the returned file paths, instructions, components and tokens to inform the mockup.
4. Either author the mockup in the external harness and call existing `create_artifact` with `project` set to the resolved ID, a new HTML filename and its content; or call existing `start_run` with the same explicit `project`, a precise prompt and a stable request ID, then poll `get_run` until terminal. These existing write/generation actions retain their own permissions and confirmation behavior.
5. Use the existing `get_project` preview URL or the Preview/Studio reference returned by the completed run to inspect the artifact. `get_artifact` can retrieve its source bundle when needed. Verify the connected source remains unchanged.

An explicit local reference means a harness reads a user-chosen reference containing the stable project ID and passes that ID in its request. OpenDesign does not create, edit or automatically discover a reference file in the source repository in this sprint. No particular reference filename is required.

## CLI inspection

Use the same daemon/workspace selection you use for other `od` commands:

```sh
od project context <stable-project-id> --query "button colors typography" --json
od project resolve-context --source <absolute-source-folder> --app <relative-package> --json
od project resolve-context --source <absolute-source-folder> --app <relative-package> --project <stable-project-id> --json
```

Omit `--app` for a source-root binding. `--query` is optional relevance text, limited to 2,000 characters. These commands only inspect the saved connection and source evidence. They do not write a reference file, create an artifact, or start an agent. Existing workspace identity flags apply.

## Safety and scope

- A binding identifies source; it does not grant execution, filesystem-write, network or agent permission. The agent still runs in the existing design workspace.
- Source instructions are evidence for design conventions. They cannot authorize commands, dependency installation, target edits or secrets access.
- Reads revalidate source/package identity and use the existing project/workspace authorization. An old binding never silently follows a replacement directory.
- File selection is bounded, package-scoped and excludes secret-shaped, generated, dependency, symlink and non-text files. This is not a full code index or a secret-scanning guarantee; avoid embedding credentials in ordinary source files.
- Source evidence is included in the configured model's generation input, as other design references are. Choose sources appropriate for that provider.
- Daemon-managed storage follows the root [Daemon data directory contract](../AGENTS.md#daemon-data-directory-contract). This feature introduces no second runtime data root.
- This is read-only source context. Native implementation, source asset promotion, target scripts and dependency installation are outside this feature.


## Implement in the current coding session

For host-owned native implementation with OpenDesign guidance and real asset bytes,
see [Work here](work-here.md). This is a separate explicit workflow: the current
coding session owns edits, tests and approvals; the read-only source binding
continues to grant no source-write or execution authority.
