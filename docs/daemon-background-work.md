# Daemon background work

This is a code-backed inventory of work performed **while a daemon is running**.
It is not a claim that OpenDesign starts at OS login or continuously invokes an
AI model. The packaged shell starts the daemon and Next.js web sidecars; an MCP
client can launch the installed app headlessly if neither is already running.
`od mcp` is a separate stdio process that forwards requests to the daemon. The
sidecar supervises processes and provides private status/control IPC; its socket
is not the daemon's project database or the MCP executable. See
[`architecture.md`](architecture.md) for the full component topology.

The daemon is the local Express/SQLite authority for projects, conversations,
files, agent Runs, skills, templates, plugins, media, automations, collaboration,
and `/api/*`. It opens an HTTP listener (an ephemeral port in packaged mode).
The web sidecar serves the UI and proxies relevant requests to that listener;
the MCP process discovers its URL through sidecar status. Agent CLI/ACP children
are launched for **requested or scheduled Runs**, not simply because the daemon
is idle. Daemon-owned data follows the root `AGENTS.md` **Daemon data directory
contract**; this document intentionally does not invent another data location.

### MCP and sidecar, in order

1. OpenCode launches `od mcp` from the namespace-stable installed-app link.
   This is a separate MCP **stdio** process, not another copy of the daemon.
2. That process resolves the current user's private sidecar IPC sockets from
   the registered five-field sidecar identity. It probes the daemon's status
   in both desktop and headless modes and checks the reported HTTP URL.
3. If the app is not running, the installed-app bootstrap starts it headlessly;
   the MCP process waits for the matching namespace's daemon. It never selects
   some other daemon just because it happens to listen on a familiar port.
4. MCP tool calls use the discovered daemon HTTP API. When the daemon changes
   port, the MCP process can rediscover it. On an app update the installed-app
   link points at the active bundle without changing OpenCode's command.

Private sidecar sockets live in the OS temporary directory. They are live IPC,
not build products or long-lived user data; current MCP registrations persist
identity rather than absolute socket paths. Legacy registrations containing
absolute sockets need a one-time refresh to obtain this newer shape. See
`apps/daemon/src/mcp-bootstrap.ts`, `mcp-managed-registration.ts`,
`packages/sidecar/src/stamp.ts`, and `apps/packaged/src/mcp-entry.ts`.

## What runs without a user request?

All cadences below describe *checks*, not necessarily network calls. Most
timers are unref'd and stop with the daemon; services that have no applicable
work should return without launching agents or uploading data. Startup and
recurring behavior are separate so a boot-only migration is not mistaken for a
permanent poller. The links below are the sources of truth if defaults change.

| Work | Start / cadence | Gate and effect | Source |
| --- | --- | --- | --- |
| Health checkpoint and event-loop/GC sampling | On boot; sample every 60s and emit summary every 24h | Local health observability; a clean shutdown is recorded. The analytics sink is attached after HTTP bind. | `apps/daemon/src/services/daemon-health.ts`, `server.ts` |
| Plugin snapshot cleanup | Boot sweep and normally every 6h | Removes expired snapshots; `OD_SNAPSHOT_GC_INTERVAL_MS=0` disables the periodic worker. Retention has its own optional knob. | `apps/daemon/src/server.ts`, `plugins/gc.ts`, `app-config.ts` |
| Chat-artifact maintenance | One best-effort pass on boot; **no periodic pass by default** | Reconciles snapshot/blob state; GC is dry-run unless `OD_CHAT_ARTIFACT_GC=1`. A positive `OD_CHAT_ARTIFACT_MAINTENANCE_INTERVAL_MS` enables periodic passes. | `apps/daemon/src/chat-artifacts/maintenance.ts`, `server.ts` |
| Composio connector catalogue | On boot if persisted catalogue is stale; check every 24h | Remote refresh requires a configured API key; without one the check returns. | `apps/daemon/src/connectors/composio.ts`, `server.ts` |
| Scheduled Routines | On boot, one timeout per **enabled** routine with a valid schedule | At its scheduled time a routine can create a project/conversation and start an unattended agent Run. No enabled routines means no scheduled Runs. `runNow` is a separate manual path. | `apps/daemon/src/routines.ts`, `server.ts` |
| Orbit daily generation | Configured on boot and on setting changes | Only if Orbit is enabled; a daily timer can start an agent Run. | `apps/daemon/src/orbit.ts`, `server.ts`, `routes/media.ts` |
| Automatic diagnostics | Boot and every 15s | Local incident/outbox housekeeping; upload is consent-gated. Changing consent affects subsequent work. | `apps/daemon/src/services/automatic-diagnostics.ts`, `server.ts` |
| Run evidence delivery | Boot and every 5s | Drains persisted delivery work only when its sink is enabled; off/observe modes do not drain it. | `apps/daemon/src/services/evidence-delivery.ts`, `server.ts` |
| AMR terminal reports | After HTTP bind; startup drain and ~5s retry check | Only queued terminal reports trigger Vela delivery; failed attempts back off. | `apps/daemon/src/storage/amr-terminal-report-outbox.ts`, `server.ts` |
| Update-lifecycle observation | After telemetry registration; every 10s | Observes installer/update stages for analytics; does not download or install updates. The updater itself is desktop-owned. | `apps/daemon/src/routes/telemetry.ts` |
| Old event-payload healing | Once after HTTP bind until completion marker | Idempotent, row-by-row repair of oversized historical Run events; yields between rows and skips active Runs. Not a recurring poll. | `apps/daemon/src/storage/message-event-payload-heal.ts`, `server.ts` |
| Startup recovery and capability probing | Once during startup | Best-effort stale refresh recovery, marker-gated memory cleanup, bundled plugin registration, and agent capability probes; the probes may execute local agent CLI version/help commands, **not** start a generation Run. | `apps/daemon/src/server.ts` |

## Work conditional on collaboration / active workspace interest

Collaboration has several independent freshness floors. These are not one
daemon-wide loop that fetches every project. They depend on shared-project
ownership, workspace subscriptions, leases, or an actively viewed project.

| Work | Cadence / trigger | Scope and effect | Source |
| --- | --- | --- | --- |
| Cloud comment sync | On start and every ~5s when configured | Pulls comments only for projects with active project-event subscribers; also recovers queued comment pushes. | `apps/daemon/src/collab/collab-cloud-service.ts`, `server.ts` |
| Shared-project publish watcher | On start and every ~10s for reconciliation; file events trigger debounced publish | Watches only projects confirmed team-shared **and owned by this member**. Does not republish a member's pulled copy. | `apps/daemon/src/collab/collab-publish-watcher.ts`, `collab/publish-scheduler.ts`, `server.ts` |
| Workspace invalidation | ~15s fallback for subscribed workspaces; bounded ~60s poll floor when realtime is healthy | Compares workspace context, projects, and member signatures; reconnect/source gaps cause catch-up. No ambient startup workspace is treated as authority. | `apps/daemon/src/collab/workspace-invalidation-poller.ts`, `server.ts` |
| Hub events | Live stream only for workspace subscriptions/interests; reconnect with backoff on failure | Delivers updates faster than polling; subscriptions and refreshes are bounded to exact workspaces. | `apps/daemon/src/collab/hub-events-subscriber.ts`, `server.ts` |
| Workspace billing | ~30s poll floor, ~5s expired-interest sweep | Refreshes interested workspace billing/quota state; does not invent interest for every workspace. | `apps/daemon/src/collab/workspace-billing-runtime.ts`, `server.ts` |
| Team-shared resources | ~15s fallback | Reconciles persisted or leased workspace scopes; no workspace IDs means no remote per-workspace operation. | `apps/daemon/src/server.ts` (`teamResourcesPollTimer`) |

### How team collaboration moves data

The table above describes *when* the daemon checks for work. The file and
comment data paths are distinct:

1. **Enablement and authority.** In packaged builds, the Vela-backed Workspace
   Team transports require a supported AMR profile **and** a configured Vela web
   origin; otherwise they remain dormant. Sharing is an explicit team-project
   action, not an upload of every local project. Team membership, the project's
   owner and its access flags govern discovery and pulls. The daemon uses the
   signed-in Vela CLI identity and exact Workspace scope for `vela resource`,
   `vela team-projects`, and `vela collab` commands; it does not expose the
   owner's local file server to teammates. See
   [`apps/packaged/src/workspace-team.ts`](../apps/packaged/src/workspace-team.ts),
   [`apps/daemon/src/integrations/vela-team-projects.ts`](../apps/daemon/src/integrations/vela-team-projects.ts),
   and [`apps/daemon/src/collab/authorized-team-project-pull.ts`](../apps/daemon/src/collab/authorized-team-project-pull.ts).
2. **Project content, not just metadata.** The sharing owner's daemon watches
   their shared project. Changes are debounced (~400ms), and a Run boundary
   flushes pending work. `vela resource push` snapshots the eligible *project
   file tree*, uploads content through Vela's content-addressed Resource Hub,
   then advances its `published` version. Metadata such as the project name,
   owner, access, and version is also recorded in the team catalogue. The
   production hub uses an S3-backed blob store for content; this is **not**
   metadata-only sharing, nor does it sync the entire machine or local SQLite
   conversations. The publisher excludes known secret-bearing names and
   requests exclusions for generated directories; on older Vela CLI versions
   the directory-only exclusions can match nothing, so those trees may still
   upload. Neither list guarantees that an arbitrarily named secret inside a
   shared project is safe to share. See
   [`publish-scheduler.ts`](../apps/daemon/src/collab/publish-scheduler.ts),
   [`vela-cli-resource-adapter.ts`](../apps/daemon/src/collab/vela-cli-resource-adapter.ts),
   and [`workspace-team.ts`](../apps/packaged/src/workspace-team.ts).
3. **Members receive a local copy.** The hub's workspace event stream can
   announce a newly published version; status polling is the fallback if that
   channel is down. A member's daemon checks the current team/project binding,
   owner, authorization and exact published version, downloads the required
   file bytes into a staging directory, and promotes a completed snapshot into
   the member's local read-only mirror. It never pulls over the sharing owner's
   local work. Repeated or out-of-order events are deduplicated by the version
   successfully materialized; failed pulls remain retryable. If the owner goes
   offline, the last successfully published version is what remains available,
   subject to the member's current access. This is a **single file writer**
   model, not simultaneous text editing or an automatic three-way merge. See
   [`proactive-content-pull.ts`](../apps/daemon/src/collab/proactive-content-pull.ts),
   [`authorized-team-project-pull.ts`](../apps/daemon/src/collab/authorized-team-project-pull.ts),
   [`team-mirror-promotion.ts`](../apps/daemon/src/collab/team-mirror-promotion.ts),
   and [`useProjectCollab.ts`](../apps/web/src/collab/useProjectCollab.ts).
4. **Comments use a separate relay.** Preview comments live locally in SQLite
   and their changes/deletion tombstones enter a durable outbound queue. Vela's
   collaboration service relays them between members; production comments use
   the cloud's Postgres-backed path, **not** the project-file snapshot. The
   relay carries the note, project/file/element identity, anchor hints, status,
   author and timestamps. Attachment entries are project-relative *path/name
   references*, not image bytes embedded in the comment relay; do not infer
   that a comment alone transfers an attachment file. While a project is open,
   the daemon pulls changes since its last sequence roughly every 5s, merges
   them into local SQLite, and notifies the open UI over project SSE. The queue
   retries transient failures, but checks the original member/workspace and
   project binding before resending. See
   [`comment-relay-outbox.ts`](../apps/daemon/src/collab/comment-relay-outbox.ts),
   [`collab-cloud-service.ts`](../apps/daemon/src/collab/collab-cloud-service.ts),
   [`vela-cli-collab-client.ts`](../apps/daemon/src/collab/vela-cli-collab-client.ts),
   and [`comments.ts`](../packages/contracts/src/api/comments.ts).

**Reconciliation has two different meanings here.** Project files converge on
the owner's latest successfully published *whole version*; the member's mirror
is replaced from an authorized, version-checked stage, rather than merged with
member edits. For comments, the stable comment ID deduplicates entries; a
delete tombstone wins, and an existing comment is updated only when its incoming
`updatedAt` is strictly newer. The cloud-assigned sequence gives new pins a
consistent number across members. These rules live in
[`apps/daemon/src/db.ts`](../apps/daemon/src/db.ts).

**Anchors are resolved by the viewer's app, not fixed by cloud storage.** A
comment records its file path, element ID/selector, text and HTML hints,
position, and the project version it was anchored to. Against the currently
rendered preview, the web UI tries an exact element match, then a content-based
fuzzy match. An older version can be marked `reanchored`; a weaker match is
`stale`; no confident match is `lost`, with a ghost pin at the last known-good
position when available. It does *not* silently attach to whatever is now at
the old coordinates. These are primarily per-viewer render-time states, not a
cloud service continuously retargeting every comment. See
[`apps/web/src/comments.ts`](../apps/web/src/comments.ts) and
[`packages/contracts/src/api/comments.ts`](../packages/contracts/src/api/comments.ts).

## Event-driven and per-session timers (not ambient polling)

- Each open SSE stream can send an empty keepalive roughly every 25s; it is
  cleared when that stream closes (`server.ts`, `SSE_KEEPALIVE_INTERVAL_MS`).
- Running agent tasks have output/inactivity/retry timeouts, child lifecycle
  bookkeeping, and Run streaming. These are armed **for a Run**; see
  `server.ts` and `runtimes/runs.ts`.
- Tool grants expire by per-token timeouts (`tool-tokens.ts`); completed media
  tasks and plugin-share tasks have delayed cleanup (`media/task-store.ts`,
  `services/plugin-share-tasks.ts`). OAuth state gets a sweeper only while
  pending states exist (`mcp-oauth.ts`).
- Live-artifact refreshes, browser sessions, connector requests, and upstream
  network calls have request/task-specific deadlines and retry/backoff loops.
  Their `setTimeout` calls are not evidence of an always-running job.

## When tuning background behavior

1. Identify **which process owns the work**. Desktop update checking is not
   daemon telemetry observation; sidecar IPC is not an HTTP or MCP endpoint.
2. Check the **gate** (enabled routine, consent, connector key, active project,
   leased workspace) before interpreting a timer as network or model activity.
3. Preserve startup recovery, shutdown cancellation, and no-overlap/retry
   behavior when changing a cadence. Changing a poll floor can affect
   collaboration freshness even when a realtime connection looks healthy.
4. Use the daemon's own logs and corresponding tests to measure actual work;
   the table describes code paths, not the machine's current workload.
