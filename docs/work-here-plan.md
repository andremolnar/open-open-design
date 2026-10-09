# Host-owned design workflow: implementation plan

The current coding session owns edits, tests, permissions, repository rules and
visible progress. OpenDesign supplies its resolved design expertise and managed
resources through the existing MCP connection. Existing delegated generation
remains available and unchanged.

1. Verify the image chain against OpenCode V2 2.0.18 source. Fix both ordinary
   and BYOK OpenCode adapters to attach explicit `--file` inputs; test paths with
   spaces, multiple images and unchanged stdin. A filename in prompt text is not
   proof of visual delivery.
2. Add a host-context seam to the existing daemon composer. Reuse its scoped
   skill/plugin, design-system, token and craft resolution. Return ordered,
   versioned reference guidance and explicit translations for OD-only delivery,
   question, planning and critique contracts. Repository rules remain authoritative.
3. Prepare a bounded immutable context package in daemon-managed storage. Pin
   project, source package, binding revision, host session and resource hashes.
   No active-project/name fallback, nested Run, arbitrary path read, URL fetch,
   source write, new credential or provider request.
4. Expose prepare/refresh, context status, actual image/original-byte fetch,
   revision-checked idempotent checkpoints and explicit registration of existing
   managed artifacts through the same authorized HTTP boundary and MCP. The host
   may use existing artifact creation to save a preview, then register its digest;
   native implementation files remain owned by the host repository.
5. Verify exact-byte transport, missing-capability reporting, stale binding and
   context rejection, cross-project/session isolation, replay/conflict behavior,
   safe bounded resource reads and restart continuity. Run repository checks and
   independent review. Document the real-image/manual current-session experiment.

Automated tests can establish bytes, protocol and no-spawn behavior. Live image
perception depends on the user's installed host/provider/model and is a separate
manual acceptance check. No local Mac run, merge, deployment or installation is
part of this change.
