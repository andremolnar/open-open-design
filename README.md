# OpenDesign — an independent, local-first fork

**This is a hard fork of [nexu-io/open-design](https://github.com/nexu-io/open-design).** It is not the original project's hosted service or an official distribution from that team.

The point of this fork is to let you explore OpenDesign **without signing in to a service**. It removes automatic product telemetry and mandatory Cloud login for local use; the longer-term goal is to remove remaining dependencies on the original project's infrastructure. We want people and organizations to choose their own models, data boundary, and eventually their own cloud and collaboration services. Generating with a third-party model can still require that provider's credentials.

> **Today:** Local projects and the Home workspace work without a Cloud account. You can run an installed coding-agent CLI or configure your own model endpoint. This fork does not automatically send product telemetry or check the original project's release feed. Optional network-backed features still exist; this is **not yet** a fully independent, offline-only or enterprise-certified deployment. See [What leaves your machine](#what-leaves-your-machine).

## New in this fork

- **Full OpenCode V2 integration.** The upstream OpenDesign releases this fork branched from were incompatible with OpenCode V2. In this fork, select or rescan OpenCode from **Settings → Models & providers → Local CLI**, choose its models and supported reasoning variants, and configure the OpenCode models and BYOK provider settings used by OpenDesign. OpenDesign can run and resume OpenCode V2 sessions with compatible permissions, tool events, MCP servers, and image attachments. **Settings → OpenDesign MCP** also offers a copyable V2 configuration snippet to connect your own OpenCode session to OpenDesign; it does not silently edit your OpenCode config.
- **Connect a design project to an existing code repository.** Choose **Connect codebase…** from an OpenDesign project's menu, then select a local repository and, if useful, a specific app or package. Prototype in OpenDesign using bounded, read-only source evidence—such as project instructions, components, and design tokens—while artifacts stay in the project's Design Files. The connection does **not** run code, install dependencies, or edit the repository. Or, from a coding-agent session already in that repository, use OpenDesign MCP or the `od` CLI to discover the connected project, obtain its selected design guidance and original image assets from its Design Files, and implement with your agent's own tools and permissions. You can optionally save a separate preview back to OpenDesign; this does not require a second generation run or automatically copy assets into the repository. See [connected codebase context](docs/codebase-context.md) and [Work here](docs/work-here.md).

## Who this is for

- **Curious builders** who want to try AI-assisted design without creating an OpenDesign account. Bring a coding-agent CLI you already use, or configure a model provider yourself.
- **Teams and enterprises** evaluating design agents while controlling which models receive prompts, where tokens are stored, and where project data flows. The local workflow is a starting point for that evaluation, **not** a claim that every integration is self-hostable today.

OpenDesign turns a brief into editable artifacts—web and mobile prototypes, decks, documents, images, and motion—using skills, design templates, plugins, and `DESIGN.md` design systems. A local daemon manages projects and previews; the selected agent or provider does the generation. The resulting files remain available in your project workspace.

## Start without an OpenDesign account

The most reliable way to run **this fork** is from source. Upstream downloads and container images are not builds of this repository.

**Requirements:** Node.js `~24`, pnpm `10.33.2` (the version pinned in `package.json`), and macOS, Linux, or WSL2. Windows native is best-effort; see [Windows troubleshooting](docs/windows-troubleshooting.md).

```bash
git clone https://github.com/andremolnar/open-open-design.git
cd open-open-design
corepack enable
pnpm install
pnpm tools-dev run web
```

Open the local URL printed by `tools-dev`. The first visit goes to **Home**, not a Cloud sign-in gate. Local projects remain accessible when you are signed out, including after a Cloud session expires.

1. **Choose how to run an agent.** Open **Settings → Models & providers → Local CLI** to rescan installed coding agents, or configure your own API key and model endpoint in Settings. A local CLI may itself use a remote model; check that CLI's credentials and provider before sending sensitive material. BYOK API chat alone cannot read or edit project files; use a local coding-agent CLI for code changes.
2. **Write a brief on Home.** Select an artifact type and a design system, then generate and refine in the project workspace. Media generation may need a separately configured provider.
3. **Keep working in your coding agent, if you prefer.** **Settings → OpenDesign MCP** provides client-specific connection instructions for OpenCode and other compatible agents. You can inspect a connected OpenDesign project and author files in your existing coding session; a separate delegated OpenDesign generation run is optional. See [Work here](docs/work-here.md).

On macOS, `/usr/bin/od` is Apple's octal-dump tool and may shadow OpenDesign's `od` CLI. Use the absolute-path snippet shown in **Settings → OpenDesign MCP** instead of assuming `od` on your shell's `PATH` is this application.

For local packaged-app builds, see [tools-pack](tools/pack/README.md). This repository does **not** automatically build or publish binaries, releases, container images, or documentation on push.

## What leaves your machine

**Local-first is a boundary you configure, not a promise that all generation is offline.** In this fork:

| Activity | Current boundary |
| --- | --- |
| Local projects, generated files, and BYOK credentials | Managed locally by the daemon. For its data-root contract, see [AGENTS.md](AGENTS.md#daemon-data-directory-contract). |
| Product analytics, session replay, crash uploads, update checks, and hosted “What's New” | Disabled by default in this detached build. Diagnostics can be exported deliberately; a hosted highlights document requires an explicit URL. Read [PRIVACY.md](PRIVACY.md) for the precise behavior and exceptions. |
| A local coding-agent CLI | OpenDesign invokes the CLI on your machine. **The CLI's own** model calls, telemetry, authentication, and data handling are governed by that tool and its provider—not by this fork. |
| Your own model or media provider | Requests go to the endpoint you configure. That may be a public API or an internal gateway; review its policy, credentials, and network route. Internal provider hosts require an explicit `OD_ALLOWED_INTERNAL_HOSTS` opt-in because the proxy blocks private-address targets by default. |
| Original-project Cloud or account features | Still present as **optional** integrations. Choosing to sign in, use a hosted model, publish, or open an external link can contact external services. None is required to open Home or work on local projects. |
| Collaboration and community features | Some existing paths depend on external services. Bring-your-own collaboration is a **goal**, not an available self-hosted substitute yet. |

For a restricted environment, audit your chosen agent CLI, model endpoint, integrations, plugins, remote assets, and network egress before deployment. Do not infer that “no OpenDesign login” means “no third-party connections.” Docker deployments also require their own access controls. The inherited [Docker guide](deploy/README.md) defaults to an **upstream image**, not this fork; build and identify your own image before using it as a fork deployment.

## What you can build

- **Prototypes and live artifacts:** editable HTML/CSS experiences, dashboards, and mobile UI previews. Generated source can be handed to an engineering agent rather than locked in a canvas.
- **Decks and documents:** browser-viewable presentations and layouts, with export paths that depend on the artifact and its tools.
- **Images, video, and motion:** use configured media providers or code-driven [HyperFrames](design-templates/hyperframes/); these paths may require external models or local rendering dependencies.
- **Reusable design language:** [design systems](design-systems/README.md) define a brand in `DESIGN.md` and tokens; [design templates](design-templates/) define rendering shapes; [skills](skills/) and [plugins](plugins/README.md) provide agent behavior and workflows.

The web UI and `od` CLI expose project capabilities through the local daemon's API. An MCP connection lets a compatible coding agent read and, when authorized, work with project files. Explore [the architecture](docs/architecture.md), [agent adapters](docs/agent-adapters.md), and [the skill protocol](docs/skills-protocol.md) if you want to extend those paths.

## Direction of this fork

**Available now**

- Home and local projects without mandatory Cloud sign-in, including old onboarding links and recovered local-only projects.
- Local coding-agent execution, BYOK model endpoints, file-backed project work, and MCP connections to external coding agents.
- No automatic product telemetry, hosted release-feed checks, or repository-owned GitHub Actions publishers. Checks and releases must be run explicitly.

**Work ahead**

- Remove or replace remaining assumptions about the original project's account, marketplace, media, messaging, and hosted infrastructure without breaking useful local paths.
- **Bring your own cloud:** make model gateways and any necessary hosted services deployable under an operator's own account and policies, not just configurable as a model URL.
- **Bring your own collaboration:** let teams choose and operate their identity, project-sharing, and collaboration backend rather than depending on a particular upstream service.
- Make enterprise data-flow review, deployment, and verification practical. Until those boundaries are implemented and tested, do not treat the roadmap as a compliance or air-gap guarantee.

## Build and contribute

This fork keeps the original project's Apache-2.0 license and credits. Most historical product documentation, templates, and translated guides were inherited from upstream; where they describe upstream Cloud plans, download links, releases, or CI, they should **not** be read as fork-specific promises. Contributions that make those boundaries explicit are welcome.

```bash
pnpm guard
pnpm typecheck
# Run focused package checks for what you change, for example:
pnpm --filter @open-design/web test
```

There is no automatic CI safety net in this repository. Read [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md), and the relevant directory guide before changing code. File issues and proposals on [this fork's issue tracker](https://github.com/andremolnar/open-open-design/issues), not the upstream tracker, when the work concerns this fork.

## Origin and license

OpenDesign was created by the contributors to [nexu-io/open-design](https://github.com/nexu-io/open-design). This fork builds on their work while taking a different position on account requirements, infrastructure ownership, and deployment. [References and third-party provenance](docs/references.md) remain credited. The code is licensed under [Apache 2.0](LICENSE).
