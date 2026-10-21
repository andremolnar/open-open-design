# Motion dependency follow-up — 2026-10-21

**Status: dependency remediation and controlled installs completed.** The
resolved npm graph has **zero OSV matches across 1,225 package versions** after
the separately authorized local signed-build follow-up below (1,248 at the
earlier dependency-remediation checkpoint).
This is dependency/advisory evidence, not unconditional security approval for
the entire motion patch or a signed desktop release.
This follows the [initial security audit](motion-patch-security-audit-2026-10-21.md)
and the user's request to explain the generated files, replace vulnerable pins,
and install only if the review is satisfactory. Nothing in this document is
standing permission for an agent to install or execute code. Historical findings
below describe the initial state; the completed work and current limits follow.

## Signed local smoke build follow-up

The user subsequently authorized building the current `motion` working tree with
their signing identity, replacing only three named generated output directories,
and removing automatic security-attribute stripping from the build path. This
is separate from the earlier audit and dependency-install phases.

- Built a portable macOS arm64 **1.2.0** app, including uncommitted motion changes,
  using `tools-pack mac build --namespace local-smoke --to app --signed --portable`.
- Output: `.tmp/tools-pack/out/mac/namespaces/local-smoke/builder/mac-arm64/Open Design.app`.
- Strict recursive `codesign --verify --deep --strict` **passes**. The signer is
  **Apple Development: ANDRE T MOLNAR (96Q8N29FG2)**, certificate SHA-1
  `ECBA5F3699A4BC5464B4FD73E827E09EF2A99EB9`. This is not ad-hoc signing or a
  notarized Developer ID release.
- The generated launcher payload is
  `.tmp/tools-pack/out/mac/namespaces/local-smoke/payload/Open Design-local-smoke-payload.zip`;
  SHA-256: `08405c45f76ed4f6ca6d6cbf05aac8b8c099a757536a9b4318a9c9494b80b87a`.
- Removed automatic quarantine/provenance/access-control stripping from app
  build and artifact finalization, with a regression observed red before the
  fix. No attribute removal, Gatekeeper bypass or notarization was performed.
- Updated `node-abi` to 4.38.0. A first build then exposed SQLite 12's incompatible
  V8 API under Electron 45. Updated `better-sqlite3` to 13.0.3, whose stable
  Node-API binaries are validated instead of Electron-ABI rebuilt. Registry
  signatures and lockfile integrity match official metadata for these updates
  and the resolved `node-addon-api` versions. The existing database tests pass.
- The independently npm-assembled payload initially reintroduced vulnerable
  `sprintf-js`. Mac/Windows assembly now imports the reviewed workspace
  overrides, explicitly disables dependency lifecycle scripts/audit/funding
  calls, and validates the SQLite prebuilt. Windows' assembled-app cache key
  includes the translated policy, with an updated schema and witness test.
- Final fresh OSV checks: **0 matches across 1,225 workspace versions** and
  **0 matches across 158 named/versioned npm packages in the signed app**,
  including its copied standalone web runtime. Advisory matches are not a
  complete native-binary, source-code or exploitability assessment.
- Packaging regression tests, 28 focused database tests, full typecheck,
  `pnpm guard`, and `git diff --check` pass. The actual build includes fresh
  workspace compilation and a standalone Next.js production build.
- Only the approved old smoke output and two temporary web-build directories
  were deleted. Audit receipts/logs were preserved. The existing installed,
  running app was not stopped, replaced or changed. No new app was installed or
  launched, no live updater feed was checked, and nothing was published.

Exact commands, the initial failed build, successful retry, cleanup receipt,
signature output and dependency checks are retained under
`.tmp/motion-security-audit/signed-*`. Telemetry upload credentials were removed
from the build environment; this does not mean telemetry-bearing dependencies
have been removed. The earlier motion-code, helper-safety and licensing findings
remain open. Desktop interaction and Windows/Linux native packaging remain
unvalidated.

### Subsequent authorized installation and PR preparation

The user then explicitly requested installation using the repository scripts.
`tools-pack mac deploy --namespace local-smoke` rebuilt and installed version
1.2.0 at `/Applications/Open Design.local-smoke.app`, replacing the matching
1.1.0 bundle after the namespace-scoped stop. Strict recursive signature
verification passed again with the same Apple Development identity. User data
was preserved; the deployment did not launch the new app, notarize it, or publish
anything. The user subsequently opened the installed app.

The deployment rebuilt the payload, superseding the earlier build's archive
digest above. The installed-build payload SHA-256 is
`863ea8d0b09e74ecf3cab7b4b5c3160f7f6f6e4f12e767a70b932f0e58ffa192`.
Installation and signature receipts are retained in
`.tmp/motion-security-audit/signed-local-smoke-deploy-result.json` and
`signed-local-smoke-installed-verification.json`.

During PR preparation, focused checks passed: 323 web tests (three skipped),
270 daemon tests, five motion-player contract tests, 55 packaging tests and ten
cross-boundary resource/dependency tests. The first daemon run found two stale
test expectations after safety changes: the skill snapshot omitted the two new
requirements files from its expected count, and the narration registry needed
written verdicts for the missing-dependency approval guidance. Both expectations
were updated without removing the safety rules; the complete focused daemon
selection then passed. Guard, full typecheck and whitespace checks also passed.
A screenshot of the installed Home motion entry point is included in the PR,
cropped to exclude private recent-project names.

This is focused validation, not a full repository or Playwright suite run.
The known media/helper, telemetry and licensing findings remain open; the
requested source merge is not a security certification or release publication.

## Completed remediation (earlier checkpoint)

- Updated Next.js to 16.4.2, Electron to 45.0.0, the MCP SDK to 1.32.1,
  DOMPurify to 3.4.17, Multer to 2.4.0, Sharp to 0.35.5, esbuild to 0.28.2,
  Vitest to 4.1.12 and electron-builder to 26.15.3. Compatible fixed transitive
  versions are recorded in `pnpm-workspace.yaml` and the regenerated lockfile.
- Made workspace YAML the single source for overrides/build approvals, removing
  stale duplicated policy from root `package.json`. The build-approval allowlist
  was preserved, not expanded; installs still explicitly disabled scripts.
- Removed the unfixed `extract-zip`, `sprintf-js` and `braces` chains rather than
  suppressing audit results: Electron's replacement extractor, the newer proxy
  agent, Chokidar 4 and an updated Sass parent remove them. Also excluded
  PptxGenJS's unused `image-size` dependency after inspecting its shipped runtime.
- All **163 added package/version entries** have lockfile integrity values
  matching official npm metadata and valid registry signatures. No existing
  package/version had its immutable integrity changed. Registry authentication
  does not prove source-to-build reproducibility or absence of malicious code.
- Materialized verified pnpm 10.34.7 under the ignored audit toolchain directory;
  no global tool installation or persistent PATH change was made. A local shim
  supplied the exact manager to child compiler/test scripts.
- Resolved the lockfile with scripts and pnpmfile hooks disabled, then performed
  frozen, scripts-disabled workspace installs using the existing pnpm store.
  The first frozen install reported 149 package additions, 129 removals and 95
  downloads; a later direct watcher-link refresh was already up to date. These
  are package-manager dependency updates, not deletion of user data or audit
  cleanup. The root postinstall was **not run**.
- Installed the five pinned Python libraries into an isolated audit venv using
  hash-required, binary-only official PyPI wheels. Dependency checks and imports
  of all five libraries pass. The interpreter's bundled pip 26.1 had advisories,
  so setup stopped before environment creation and used an authenticated-hash
  official pip 26.2.2 wheel instead, without changing global pip.

### Compatibility fixes and validation

The initial compatibility run exposed two real regressions, both fixed:

1. Chokidar 4 regressed macOS descriptor usage (160 additional descriptors in
   the existing test, versus a required bound below 32). macOS now uses
   `@parcel/watcher@2.6.0`'s native FSEvents backend through a file-event adapter;
   Chokidar remains the portable/polling fallback. The adapter preserves ignored
   paths, symlink containment, write-stability waiting, close cancellation and
   refcounted subscription behavior. Both packaging lanes declare the native
   package as an external runtime dependency. This package was already in the
   reviewed graph via Sass. The original descriptor bound was **not weakened**.
2. Electron 45 removed the obsolete `websql` clear-storage option. Removed that
   option from desktop's request/type list; the full workspace typecheck passed
   with the supported storage types.

A separate close-concurrency regression was observed red, then fixed to share
one unsubscribe promise; the native adapter tests now cover it. Packaging no
longer copies Chokidar 3's old native `fsevents` package through a hardcoded
private dependency path.

Validation includes the dependency-policy regression, native/portable watcher
tests, Mac/Windows prebundle tests, guard, full typecheck, daemon build,
tools-dev build and the Next.js production build. The web validation build uses
`apps/web/.next-security-audit` with telemetry disabled; it does not overwrite
the normal web output. Next's temporary tsconfig/next-env pointer edits were
removed after the build. An earlier root-level scratch output path failed
generated-type resolution; moving the validation output inside the web package
fixed the check without weakening TypeScript or changing production config.

Final completion checks, after restoring the ordinary web configuration:

| Check | Result |
| --- | --- |
| Fresh OSV query of all 1,248 locked npm versions | **0 matches** |
| Watcher integration + native-adapter tests | **17 passed** |
| Mac/Windows prebundle contract tests (on this Mac) | **24 passed** |
| Cross-package dependency-policy tests | **5 passed** |
| `pnpm guard` | **Passed** |
| Full `pnpm typecheck` | **Passed** |
| Daemon and tools-dev package builds | **Passed** |
| Next.js 16.4.2 production server build, isolated output | **Passed** |
| Python dependency check + five library imports | **Passed** |
| macOS strict signature verification of raw Electron development app | **Failed; not bypassed or launched** |

These are focused checks, not a claim that the full repository test suite,
Windows/Linux native packaging, browser interaction or desktop visual testing
was performed. All changes remain uncommitted on `motion`.

### Electron runtime trust boundary

Downloaded Electron's official 120,706,020-byte Mac arm64 archive through its
reviewed dependency installer, into the dependency's `dist`, not `/Applications`.
SHA-256 `896c3a50b148e89a158dca08a6996a022ddf39b23aac871e107f5b4087f8caa9`
matches both the signed npm package's checksum manifest and the official GitHub
release asset digest. All 584 archive entries match the extraction, including
file bytes, symlink targets and recorded permission modes.

**The official development archive is ad-hoc/linker-signed, not a Developer ID
application bundle.** `codesign --verify --deep --strict` fails with “code has no
resources but signature indicates they must be present”; the archive itself
contains no `_CodeSignature/CodeResources` entries. This is not an extraction
error, and registry/archive authenticity is not macOS release-signing approval.
At that checkpoint the runtime was **not launched**, re-signed or
security-bypassed. The later authorized build above signs its packaged copy;
the original dependency extraction remains unchanged. Launch, installation and
notarized release distribution remain separate steps.

### Current local entrypoints

- Project-local pnpm: `.tmp/motion-security-audit/toolchain/bin/pnpm` (temporary
  PATH prefix needed by nested scripts; no global setup was changed).
- Python libraries: `.tmp/motion-security-audit/python-motion-env/bin/python`.
  The venv intentionally has no bundled vulnerable pip; the reviewed installer
  lives separately at `.tmp/motion-security-audit/toolchain/pip-26.2.2/`.
- Logs, exact commands, dependency receipts and checksum/signature evidence stay
  under `.tmp/motion-security-audit/`. These are ignored local files, not shipped
  source or daemon runtime data. No application/service was started for use.

Still open: pre-existing DeepSeek peer-version warnings (all those package
versions remain unchanged), React 18's Next 17 deprecation warning, full desktop
visual/packaged validation, and the initial audit's separate motion-code,
destructive-helper, telemetry and licensing decisions. Passing dependency
checks does not close those unrelated findings or authorize `--force` helpers.

## What the 2,768 generated files actually are

These are outputs of **this repository's workspace builds**, not 2,768 newly
downloaded dependencies or unknown executables:

| File type | Count | Purpose |
| --- | ---: | --- |
| `.js` | 740 | Compiled JavaScript, mainly daemon modules |
| `.mjs` | 42 | ESM bundles/entrypoints |
| `.cjs` | 3 | CommonJS compatibility outputs |
| `.d.ts` | 996 | Type declarations for workspace consumers |
| `.js.map` | 737 | Source maps |
| `.d.ts.map` | 247 | Declaration source maps |
| `.css` | 1 | Shared component stylesheet |
| `.json` | 2 | Build metadata |
| **Total** | **2,768** | |

2,211 are under `apps/daemon/dist`; the remainder belong to 15 shared packages
and two development tools. The existing root postinstall runs TypeScript/esbuild
compilation in dependency order. The separate dom-to-pptx bundle write expands
an existing compressed browser bundle. The imported Python helpers were not
part of those builds. The only new npm package found in the incident remains
GSAP 3.14.2, whose installed files match the official registry artifact.

These are expected build destinations and command types, not unexplained
payloads. This does not certify every compiled source module, imported compiler
dependency or existing runtime dependency as vulnerability-free. The original
problem was unapproved execution; the dependency findings below are separate.

## Safer version selections prepared

| Component | Old selection | New exact selection |
| --- | --- | --- |
| pnpm | 10.33.2 | **10.34.7**, minimum `>=10.34.7 <11` |
| Pillow | `>=10.0.0` | **13.0.0** |
| NumPy | `>=1.24.0` / implicit | **2.5.4** |
| PyYAML | `>=6.0.0` | **6.0.3** |
| SciPy | implicit | **1.18.1** |
| opencv-python | implicit | **5.0.0.93** |

Each exact version returned **no OSV matches at review time**. This is not proof
of absence of vulnerabilities, bundled-native-library issues or malicious code.
NumPy/SciPy require Python 3.12+. Library imports now pass on this host; full
motion-helper workflows have not been run.

### pnpm

- Updated the repo selection and engine minimum, mise selection, deployment
  Dockerfile and Linux packaging bootstrap. Kept an exact reproducible selection
  rather than changing to a floating `latest` or silently jumping to pnpm 11.
- Updated active setup docs. Old versions in incident evidence, historical
  validation records and synthetic process-discovery fixtures are intentionally
  not rewritten as if the past used the new version.
- The official npm 10.34.7 tarball matches its published SHA-512, contains no
  symlink/path-traversal archive members and declares no runtime dependencies or
  install lifecycle scripts. Its registry signature verifies with system
  OpenSSL. After initial in-memory inspection, it was materialized locally and
  used for the controlled resolutions, installs and validation described above.
- Linux standalone hashes now match the official v10.34.7 GitHub release asset
  digest metadata for x64 and arm64. Those standalone binaries were **not**
  downloaded or executed; this is a metadata check, not a binary audit.

### Optional Python helpers

- Replaced Oil Motion's open ranges and added explicit UI Animation requirements.
- Added `scripts/requirements-macos-arm64-py314.txt` to each skill. These contain
  exact version pins, official wheel SHA-256 values, the PyPI index, binary-only
  resolution and required hash checking. All transitive runtime requirements
  declared in the reviewed metadata are covered (SciPy/OpenCV require NumPy).
- The generic requirements retain the same versions for other platforms, which
  need their own reviewed wheel hashes. Do not remove checks or compile an
  arbitrary source distribution to work around an unavailable wheel.
- The current host has Node 24.18.0, CPython 3.14.4 and macOS arm64. The selected
  OpenCV wheel requires macOS 13+, which this host meets. This is metadata
  compatibility. Subsequent isolated installation/import checks passed; no
  global Python changes were made and no destructive skill helper was run.
- Hashes were checked against official PyPI release metadata and enforced during
  wheel installation. No independent source-to-wheel attestation or malware-free
  claim is made.

## Historical blockers before the completed remediation

### Existing npm dependency advisories

A full static OSV check of **1,336 npm package/version entries** from the original
lockfile found **47 matching version entries across 40 package names**, involving
**148 unique advisories**. Advisory severity labels: four critical, 66 high,
64 moderate and 14 low. These are version matches, **not 148 proven exploitable
paths in this application**. This was not a package-manager audit command and
did not install or execute any dependency.

Examples in that original lockfile (subsequently updated/removed above):

| Dependency | Locked version | Selected finding / context |
| --- | --- | --- |
| `next` | 16.2.6 | Critical findings include AVIF image optimization, Windows-hosted servers, and Node `next/og` with attacker-controlled SVG. Applicability depends on the feature/platform; do not label every route exploitable. |
| `proxy-addr` | 2.0.7 | Critical upstream label for trust-subnet misconfiguration/IP spoofing; requires the affected proxy-trust configuration. |
| `electron` | 41.3.0 | Multiple high/moderate findings; a supported-runtime update needs desktop/packaging validation. |
| `@modelcontextprotocol/sdk` | 1.29.0 | High/moderate findings; current upstream 1.32.1 has no OSV matches. |
| `sharp` | 0.34.5 and 0.35.3 | Image-processing findings; review the actual runtime/native artifacts, not only the JavaScript wrapper. |
| `@xmldom/xmldom` | 0.8.13 and 0.9.10 | XML parser findings; transitive consumers and compatible update lines need review. |
| `braces` | 3.0.3 | Latest published release still matches a stack-exhaustion advisory. |
| `extract-zip` | 2.0.1 | Latest published release still matches symlink/path-traversal advisories. |
| `sprintf-js` | 1.1.3 | Latest published release still matches a precision-driven DoS advisory. |

Most names have a newer release without OSV matches, but some require a major
upgrade. Blindly forcing all transitive packages to their latest major release
would not be a safe fix. Three latest candidates still have matches as listed
above; removing/replacing the dependency, mitigating the use or documenting
unreachability is needed rather than inventing a patched version.

The motion patch did not introduce these affected version entries. This check
is broader than the original new-dependency audit; it must not be confused with
evidence of an installed backdoor. The initial audit's media-containment,
destructive helper, telemetry and licensing decisions are also still open.

### Pre-existing duplicate override configuration drift

Seven override entries disagree between `pnpm-workspace.yaml` and the lockfile:

| Package/selector | Workspace | Lockfile |
| --- | --- | --- |
| `brace-expansion` | 5.0.6 | 5.0.9 |
| `fast-uri` | 3.1.2 | 3.1.5 |
| `hono` | 4.12.19 | 4.12.34 |
| `ip-address` | 10.2.0 | 10.3.1 |
| `tar` | absent | 7.5.22 |
| `undici@^6` | absent | 6.28.0 |
| `undici@^7` | absent | 7.29.0 |

Read-only comparison with `HEAD` confirms this predates the motion patch and
these remediation edits. **The root `package.json#pnpm.overrides` matches the
lockfile**, unlike the workspace YAML. Static inspection of pnpm 10.34.7 shows
workspace settings initially applied over root settings, but install paths
reapply root-manifest options. Therefore this conflict is **not evidence that
a frozen install necessarily fails**; an earlier progress statement asserting
that was too strong. No install was attempted to test it. Reconcile duplicate
configuration deliberately during remediation rather than downgrading locked
packages to stale YAML values or discarding frozen-lockfile protection.

## Remaining execution boundary

The user's subsequent approval of broader remediation and necessary safe setup
enabled the controlled operations recorded above. It is not standing permission
to run the root postinstall, rebuild arbitrary native addons, launch an untrusted
application, publish/sign a release, or clean user/runtime data. No root
postinstall, blanket lifecycle execution, native source compilation, destructive
motion-helper command, product app launch or security bypass was performed.
`skills-ref` remains unavailable; no downloader fallback was used for it.

## Evidence

Local, ignored `.tmp/motion-security-audit/` evidence includes:

- `remediation-version-candidates.json`: official pnpm/PyPI metadata and queries.
- `pnpm-10.34.7-artifact-review.json` and `signature-pnpm-10.34.7.*`: tarball
  integrity/archive review and signature-verification inputs.
- `pnpm-10.34.7-github-release.json`: release and standalone asset digest metadata.
- `full-lockfile-advisory-matches.json`, `full-lockfile-advisory-details.json`,
  `full-lockfile-triage.json`: complete version matches, advisory descriptions,
  severity and per-package fix information.
- `npm-remediation-candidates.json`: upstream latest-version candidates and OSV
  results; candidates are research, not approved install selections.
- `preexisting-override-drift.json`: workspace/lockfile discrepancy evidence;
  root overrides match the lockfile, as clarified above.
- `pnpm-config-precedence-source-excerpts.json` and
  `pnpm-config-precedence-call-sites.json`: static package-manager source review
  showing why duplicate settings alone do not prove a frozen-install failure.
- `remediation-static-checks.json`: pin/hash consistency, output-type counts and
  the initial static-only status before approval of subsequent work.
- `resolved-lockfile-security-scan-2.json`, `resolved-additions-provenance.json`:
  clean resolved graph, all 163 new artifact metadata/integrity/signature checks.
- `resolution*.log`, `reviewed-install*.json`, `reviewed-install*.log` and
  `native-watcher-install-results.json`: exact controlled install operations.
- `python-install-report.json`, `python-install-result.json`,
  `python-validation-results.json`, `pip-safe-tool-candidate.json`: Python
  artifact hashes, isolated installer and passing dependency/import checks.
- `reviewed-validation-results*.json`, `final-validation-results.json`,
  `scoped-build-results.json` and individual logs: red/green compatibility
  evidence, typechecks and builds. Earlier failed attempts remain recorded.
- `completion-validation-results.json` and
  `completion-security-and-validation.json`: final passing tests/guard/typecheck,
  fresh zero-match advisory query and final lockfile digest. These supersede
  the earlier failed attempts without deleting their evidence.
- `electron-runtime-install-result.json`, `electron-codesign-verification.json`,
  `electron-archive-extraction-comparison.json`: authentic development runtime
  bytes and the deliberately unbypassed macOS signature-verification failure.
