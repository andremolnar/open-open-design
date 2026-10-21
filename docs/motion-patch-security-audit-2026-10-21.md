# Motion patch: pre-execution security and installation audit

**Decision: HOLD. This patch is not security-approved for execution or release.**

This is the original audit decision, not a claim that later user-authorized
remediation, building or installation did not occur. The follow-up report records
those separate approvals, the installed signed local build, and the remaining
risks. A requested source merge does not close this audit or certify a release.

**Dependency follow-up:** the original incident/version inventory below is
historical, not the current dependency prescription. The user subsequently
requested safer versions: pnpm now selects 10.34.7, and optional Python
requirements are exactly pinned with a macOS arm64/CPython 3.14 wheel-hash lock.
The wider lockfile check initially blocked installation. Following the user's
approval, those dependency advisories were remediated (zero OSV matches across
1,248 resolved npm versions), duplicate policy was consolidated, and controlled
scripts-disabled installs and focused compiler/tests were performed. Python
libraries were installed in an isolated, hash-checked environment. This does not
close the separate code, telemetry, license or desktop-signing findings below.
See
[`motion-dependency-remediation-2026-10-21.md`](motion-dependency-remediation-2026-10-21.md)
for the current status and evidence limitations.

Audit date: 2026-10-21. Branch: `motion`. The audit covers the supplied patch,
the unintended installation in this session, and unsafe repository guidance.
It is not a claim that every existing dependency or this machine is malware-free.

## Executive findings

| Finding | Assessment |
| --- | --- |
| Unrequested dependency installation and root postinstall | Confirmed. GSAP was installed and workspace build scripts ran before the user stopped the command. |
| New npm dependency | Only `gsap@3.14.2`; no transitive dependencies or lifecycle scripts. Its locked integrity, npm registry signature, and all 179 installed files match the official registry artifact. |
| Package manager | Reused pre-existing cached `pnpm@10.33.2`, not a newly installed global pnpm. All 1,076 cached package files match the official artifact. **OSV reports 18 applicable advisories**, including integrity, traversal, secret-disclosure and build-policy issues. |
| Binary patch payloads | 28 files: 17 TrueType fonts, five JPEGs, five MP3s, one gzipped JavaScript file. All match the claimed upstream commit exactly. No native executable was found among them. Matching provenance is not a decoder-safety certificate. |
| Bundled JavaScript | Three.js r160 is byte-identical to the official npm artifact; its gzip expands to those same bytes. Five copies of GSAP 3.12.5 differ from the official artifact only in comment/trailing whitespace, not JavaScript code. Three.js add-on bodies match official r185 sources. |
| Telemetry | No newly added motion collection endpoint or tracking SDK found in patch additions. Existing HyperFrames contains default-enabled CLI telemetry and PostHog in its standalone Studio; the patch disables CLI telemetry on OD's render invocation. This is **not** complete removal of telemetry-bearing third-party code. |
| Optional Python dependencies | Not installed by this operation. Newly imported helpers require Pillow, NumPy, PyYAML, SciPy and OpenCV. Requirements are open-ended or absent; no approved, hash-locked environment exists. The allowed Pillow 10.0.0 floor has published vulnerabilities. |
| Destructive imported helpers | Oil Motion scripts can recursively delete caller-selected output directories under `--force`; one flag also bypasses artifact-hash validation. Instructions have been tightened; the implementations still require hardening before use. |
| Licensing | GSAP runtime is **not MIT**; it uses Webflow's restricted no-charge license. Motion.Lab has a README MIT declaration but no upstream license file. Font subsetting/RFN compliance and complete vendor notices remain review items. |
| Suspected media boundary gap | New cover validation passes project-selected `.mp4` content to FFmpeg without an explicit demuxer/protocol allowlist. Static evidence warrants a regression/spec and hardening; no exploit was executed. |

## 1. Patch identity and scope

- Input: `/Users/andremolnar/Downloads/open-open-design-motion-20261021.patch`.
- SHA-256: `1ee8b0c16c3c77554fa9cc417059fa6de936f11b00ce4b272bb5e7c8a13850af`.
- 344 file changes, including 206 new files; Git reports 38,838 insertions and
  263 deletions. Binary payloads account for 2,165,496 bytes.
- Before audit remediation, **all 344 applied files matched the patch's expected
  Git blob IDs**. The reverse-application check also passed. This establishes
  faithful application, not that the patch was signed by a trusted author.
- Claimed upstream source resolves to
  [`81cbb979db9ae7c6a808a5d068b02d03e7d6f706`](https://github.com/nexu-io/open-design/commit/81cbb979db9ae7c6a808a5d068b02d03e7d6f706),
  dated 2026-10-14, for the motion workflow port.
- No new `.sh` installer, native executable, package lifecycle hook, Git hook,
  `.npmrc`, or pnpm hook was introduced by this patch.

The audit read files, Git diffs, metadata and timestamps; parsed source as data;
queried public npm/PyPI/GitHub/OSV endpoints; and compared public artifacts in
memory without extracting or executing their code. Registry signatures were
checked using the existing system OpenSSL. No package manager, build, test,
imported skill script, installer or application was run **during this audit**.

## 2. Exactly what the manifests changed

All 17 changed `package.json` files bump `1.1.0` to `1.2.0`:

```text
package.json
apps/daemon/package.json
apps/desktop/package.json
apps/packaged/package.json
apps/web/package.json
e2e/package.json
packages/contracts/package.json
packages/download/package.json
packages/host/package.json
packages/launcher-proto/package.json
packages/platform/package.json
packages/release/package.json
packages/sidecar-proto/package.json
packages/sidecar/package.json
tools/dev/package.json
tools/pack/package.json
tools/release/package.json
```

Only two have additional package-manifest changes:

1. `apps/daemon/package.json`: runtime dependency `gsap: "3.14.2"`.
2. `packages/contracts/package.json`: export
   `./runtime/motion-source-player` with its declaration and `.mjs` output paths.

`pnpm-lock.yaml` adds only the GSAP importer entry, package integrity entry and
empty dependency snapshot (eight added lines). Existing package resolutions,
build allowlists and workspace configuration are unchanged. No script or bin
declaration changed. The root `postinstall` was already present.

Other dependency-related configuration:

- `packages/contracts/esbuild.config.mjs` adds the source-player build entry.
- macOS and Windows prebundle policies add `gsap@3.14.2` as an external runtime
  dependency; these are packaging dependency declarations, not additional npm
  packages. The Linux packaging lane was not validated.
- Five new example plugin manifests declare local HTML/poster/assets and
  `prompt:inject`; no new installer, MCP server or credential connector is
  declared. The OD Next manifest adds the motion task profile/resources.
- `skills/oil-motion/scripts/requirements.txt` adds optional Python requirements:
  `Pillow>=10.0.0`, `numpy>=1.24.0`, `PyYAML>=6.0.0`. Other measurement scripts
  additionally import SciPy and `opencv-python`, without a lockfile.

## 3. What the unintended install actually did

### Commands and evidence

1. `corepack pnpm install`: failed immediately, Corepack unavailable.
2. `pnpm --version`: Volta shim failed because pnpm was not installed in Volta.
3. `npm exec --yes --package=pnpm@10.33.2 -- pnpm install`: **did execute**.
   The shell tool was interrupted and returned no lifecycle transcript.

The surviving npm log is
`/Users/andremolnar/.npm/_logs/2026-10-21T14_10_42_083Z-debug-0.log`.
It records the exact command and a successful GET to
`https://registry.npmjs.org/pnpm`. It also records normal npm log rotation
(removing one old log). It has no final exit record; successful completion of
the entire install cannot be asserted.

The evidence window used was **14:10:40–14:11:55 UTC** (10:10:40–10:11:55 local),
deliberately wider than the observed writes. Timestamp correlation is not a
pre-operation filesystem snapshot or an operating-system execution trace.

### Installed package and exact destinations

| Item | Observed destination / result |
| --- | --- |
| GSAP 3.14.2 package | `/Users/andremolnar/repos/open-design/node_modules/.pnpm/gsap@3.14.2/node_modules/gsap` — 179 files, 6,255,076 bytes. |
| Daemon dependency link | `/Users/andremolnar/repos/open-design/apps/daemon/node_modules/gsap` points to that package. |
| Private hoisted link | `/Users/andremolnar/repos/open-design/node_modules/.pnpm/node_modules/gsap` points to that package. |
| Shared pnpm store | `/Users/andremolnar/Library/pnpm/store/v10` — one new GSAP package index and 178 incident-window content files (one of the 179 package contents was reused/deduplicated). |
| GSAP store index | `/Users/andremolnar/Library/pnpm/store/v10/index/3f/cfe633154b53ba38fb9e7ed530a742b3e68233ca9f093391738ad5ab2747d2-gsap@3.14.2.json`. |
| pnpm executable reused | `/Users/andremolnar/.npm/_npx/ed17c428e728397e/node_modules/pnpm/bin/pnpm.cjs`. Package and lockfile date to September 30; no new pnpm package installation was observed. |
| npm metadata cache | `/Users/andremolnar/.npm/_cacache` — new pnpm packument content (1,907,882 bytes) plus its cache index. This is metadata, not a new global tool installation. |
| Workspace install state | Repo `node_modules/.modules.yaml`, `node_modules/.pnpm/lock.yaml`, dependency links and `.bin` wrappers were rewritten/refreshed. |

The only package directory newly created in the repo virtual store during that
window is `gsap@3.14.2`. No Python package installation or new global Node/pnpm
installation was found in the inspected evidence. The user `.npmrc` contains
only `engine-strict`, not registry credentials; the repo has no `.npmrc`.
Environment-variable credentials were not enumerated or disclosed.

### Root postinstall and generated outputs

The existing root hook invokes `node ./scripts/postinstall.mjs`. It materializes
the vendored dom-to-pptx browser bundle, runs dependency-ordered workspace build
scripts, then can load/probe and conditionally rebuild `better-sqlite3`.

Filesystem evidence shows **2,768 generated files in 18 output directories**
written during the incident:

| Output directory | Files with incident-window modification times |
| --- | ---: |
| `packages/release/dist` | 4 |
| `packages/components/dist` | 16 |
| `packages/platform/dist` | 15 |
| `packages/registry-protocol/dist` | 7 |
| `packages/diagnostics/dist` | 9 |
| `packages/dsh-runtime/dist` | 7 |
| `packages/contracts/dist` | 337 |
| `packages/download/dist` | 33 |
| `packages/host/dist` | 16 |
| `packages/sidecar-proto/dist` | 3 |
| `packages/sidecar/dist` | 36 |
| `tools/serve/dist` | 10 |
| `packages/standalone/dist` | 27 |
| `packages/agui-adapter/dist` | 7 |
| `packages/plugin-runtime/dist` | 25 |
| `packages/launcher-proto/dist` | 3 |
| `tools/dev/dist` | 2 |
| `apps/daemon/dist` | 2,211 |

Additionally:

- `apps/desktop/vendor/dom-to-pptx/dom-to-pptx.bundle.js` was rewritten from
  its existing compressed source at 14:10:46 UTC.
- Existing CLI wrapper files have incident-window metadata changes consistent
  with package-manager executable/link refreshes, not source-content changes.
- `packages/components/esbuild.config.ts` deletes/recreates its generated
  `dist`; `packages/dsh-runtime/clean.ts` removes its generated `dist` and
  legacy `lib` before rebuilding. Without a before snapshot, prior generated
  contents/deletions cannot be reconstructed completely.
- The latest observed daemon output writes are at 14:11:08 UTC. No matching
  new `tools/pack/dist` or `tools/release/dist` output writes were found.
- No incident-window native-addon content writes or Electron/Node download-cache
  writes were found. That does **not** prove every existing dependency hook or
  native probe did not execute; the lifecycle transcript is unavailable.
- No npm/pnpm/postinstall process remained when inspected. Existing unrelated
  applications and MCP processes were not stopped or attributed to this install.

The claim that stopping this command prevented postinstall/build execution
would be false. Builds already occurred. No rollback or uninstall was attempted:
the audit preserved evidence and did not guess which pre-existing outputs were
safe to delete.

## 4. npm source, integrity, signatures and advisories

### New dependency: GSAP 3.14.2

- [Official registry metadata](https://registry.npmjs.org/gsap/3.14.2) identifies
  publisher/maintainer `greensock` and repository `greensock/GSAP`.
- Exact tarball: `https://registry.npmjs.org/gsap/-/gsap-3.14.2.tgz`.
- Its SHA-512 matches both official metadata and the patch's lock entry:
  `sha512-P8/mMxVLU7o4+55+1TCnQrPmgjPKnwkzkXOK1asnR9Jg2lna4tEY5qBJjMmAaOBDDZWtlRjBXjLa0w53G/uBLA==`.
- The npm ECDSA signature verifies against the registry signing-key endpoint.
  All 179 installed package files match the official tarball, with no missing
  files. No archive symlink/traversal entries were found.
- No dependencies, optional dependencies, or lifecycle scripts are declared.
- No known advisories were returned by OSV for 3.14.2 at audit time. The same
  query returned none for vendored GSAP 3.12.5 or Three.js 0.160.0.
- This is registry provenance/integrity verification, **not** a publisher-signed
  source-to-build attestation, full malware analysis or security guarantee.

### Existing toolchain: pnpm 10.33.2

The [official artifact](https://registry.npmjs.org/pnpm/10.33.2) has a verified
registry signature; all 1,076 files in the reused cached installation match it.
However, authentic does not mean secure: OSV reports these 18 advisories:

| Advisory | Issue | Fixed pnpm 10 version reported by advisory |
| --- | --- | --- |
| [GHSA-3qhv-2rgh-x77r](https://github.com/pnpm/pnpm/security/advisories/GHSA-3qhv-2rgh-x77r) | Repository configuration expands environment secrets into registry requests | 10.34.2 |
| [GHSA-4gxm-v5v7-fqc4](https://github.com/pnpm/pnpm/security/advisories/GHSA-4gxm-v5v7-fqc4) | Reserved global bin names can delete PNPM_HOME | 10.34.2 |
| [GHSA-54hh-g5mx-jqcp](https://github.com/pnpm/pnpm/security/advisories/GHSA-54hh-g5mx-jqcp) | Non-frozen install can repair away an integrity mismatch | 10.34.0 |
| [GHSA-5wx6-mg75-v57r](https://github.com/pnpm/pnpm/security/advisories/GHSA-5wx6-mg75-v57r) | Dependency identity spoofing bypasses build approval | 10.34.2 |
| [GHSA-72r4-9c5j-mj57](https://github.com/pnpm/pnpm/security/advisories/GHSA-72r4-9c5j-mj57) | `patch-remove` deletion traversal | 10.34.4 |
| [GHSA-c59q-g84q-2gj5](https://github.com/pnpm/pnpm/security/advisories/GHSA-c59q-g84q-2gj5) | Virtual-store linker traversal | 10.34.5 |
| [GHSA-cjhr-43r9-cfmw](https://github.com/pnpm/pnpm/security/advisories/GHSA-cjhr-43r9-cfmw) | User npm credentials bound to repo-selected registry | 10.34.0 |
| [GHSA-fr4h-3cph-29xv](https://github.com/pnpm/pnpm/security/advisories/GHSA-fr4h-3cph-29xv) | Hoisted alias imports outside node_modules | 10.34.4 |
| [GHSA-gj8w-mvpf-x27x](https://github.com/pnpm/pnpm/security/advisories/GHSA-gj8w-mvpf-x27x) | Repo config selects native install engine | 10.34.2 |
| [GHSA-hg3w-7f8c-63hp](https://github.com/pnpm/pnpm/security/advisories/GHSA-hg3w-7f8c-63hp) | GitHub dependency tarball hash omitted from lock | 10.33.4 |
| [GHSA-hwx4-2j3j-g496](https://github.com/pnpm/pnpm/security/advisories/GHSA-hwx4-2j3j-g496) | Transitive alias traversal/symlink overwrite | 10.34.0 |
| [GHSA-p4xf-rf54-rj3x](https://github.com/pnpm/pnpm/security/advisories/GHSA-p4xf-rf54-rj3x) | Git fetch argument injection through lockfile commit | 10.34.0 |
| [GHSA-q6j5-fjx5-2mc3](https://github.com/pnpm/pnpm/security/advisories/GHSA-q6j5-fjx5-2mc3) | Missing lock integrity bypass | 10.34.1 |
| [GHSA-qrv3-253h-g69c](https://github.com/pnpm/pnpm/security/advisories/GHSA-qrv3-253h-g69c) | configDependencies environment-lock traversal | 10.34.4 |
| [GHSA-rxhj-4m44-96r4](https://github.com/pnpm/pnpm/security/advisories/GHSA-rxhj-4m44-96r4) | Malicious dependency patch write/delete traversal | 10.34.0 |
| [GHSA-vq4v-j7r6-jq4m](https://github.com/pnpm/pnpm/security/advisories/GHSA-vq4v-j7r6-jq4m) | Tarball manifest name escapes node_modules | 10.34.5 |
| [GHSA-vx52-2968-3vc6](https://github.com/pnpm/pnpm/security/advisories/GHSA-vx52-2968-3vc6) | Workspace proxy settings expand/exfiltrate secrets | 10.34.5 |
| [GHSA-w466-c33r-3gjp](https://github.com/pnpm/pnpm/security/advisories/GHSA-w466-c33r-3gjp) | Environment lock selects executable package-manager bytes | 10.34.2 |

These are version matches, not evidence of exploitation here. Several concern
commands/configuration not used in this incident. The inspected patch adds none
of those malicious configuration forms. **10.34.5 is the maximum reported 10.x
fix floor for this set**, not an endorsement of blindly updating to that exact
version; choose/research an approved maintained release before another install.
No toolchain or manifest version was upgraded by this audit.

## 5. Binary and vendor inventory

All binary files are under `plugins/_official/examples/`. Each row below matched
the same path at the full upstream commit identified in section 1. All have
non-executable filesystem mode `0644`. Hashes describe file bytes, not safety.

| Relative path | Bytes | SHA-256 |
| --- | ---: | --- |
| `motion-future/assets/cover.jpg` | 62960 | `9405e29e9e9943bdd1de5e5a5f66deeb1853362ce694976560fbd4a41c278725` |
| `motion-future/assets/jetbrains-mono-subset.ttf` | 91912 | `0e5fd8ca606481426e7ba56403c2638345be6a388572944b2947e918fb229231` |
| `motion-future/assets/soundtrack.mp3` | 240789 | `131d9e1832be0d41531fadbf35bbe9e8edae06c788c7929843b510697dc25375` |
| `motion-future/assets/three.min.js.gz` | 166574 | `678629668c97ab050b5e80749278183147d90838766ed7a3708cab634203dde1` |
| `motion-future/assets/unbounded-subset.ttf` | 140768 | `87cde87457f2cefc81445ed08d2b0347e40de53d2657c40516646109b79c14bd` |
| `motion-product-promo/assets/cover.jpg` | 21687 | `d5df429df6dda4b220247f379b16be3ec1cf534f77c9621f00c9b254af1473fd` |
| `motion-product-promo/assets/fraunces-bold.ttf` | 21300 | `e89d27fdedcead2e40c9f4e81101a8cf2e0d74322cf4d4ea19bcd2b06c354d5e` |
| `motion-product-promo/assets/instrument-serif-italic.ttf` | 32620 | `005884b02a25dcf8109d908284be660ab9b19fb2f5b4ca8945638fd1b88fc1c6` |
| `motion-product-promo/assets/inter-regular.ttf` | 28252 | `d6993d71230a6630c407a44fee8774352865cf3d81382d108f121bcd85bab67b` |
| `motion-product-promo/assets/inter-semibold.ttf` | 28332 | `ff13dd7a42f1484745ceefd313a6b26f2c4522ede95c6d37c954767362478285` |
| `motion-product-promo/assets/jetbrains-mono-regular.ttf` | 41364 | `026a648987040b2d1fc3d22ee910819187a915a3e30531c85228f6f187804f2f` |
| `motion-product-promo/assets/soundtrack.mp3` | 241205 | `74520960e8bec189417cc873395d296a9a94feb81697b5d15d3431968909ba4e` |
| `motion-showreel/assets/archivo-condensed-black.ttf` | 42492 | `69a425e975faae3b8a04a230718db31fc3f927d080f658645920af848b6857b7` |
| `motion-showreel/assets/archivo-expanded-black.ttf` | 42876 | `b515dfb122aab8e31c9d660162cb3be5e3f52411eb59cf8dd518cfc77906fd92` |
| `motion-showreel/assets/archivo-extrabold.ttf` | 42800 | `4e6b018cb749ed20397eecceb73e9ecb8cc1baed833c49b50ebd2fa2b2189b27` |
| `motion-showreel/assets/cover.jpg` | 13429 | `f94de6dbd9068ae1d046adbcf252b1fd35c07fd0c7bf66a65505192bc4a7843e` |
| `motion-showreel/assets/instrument-serif-italic.ttf` | 50652 | `70ce6946dc870d285ce3ba656e8cb1005f93a33841766a2ac788184dda97eaae` |
| `motion-showreel/assets/jetbrains-mono-bold.ttf` | 53292 | `d1818bf38fa1ef478646bef8b06700a557ed956e64ce3ef6329ae47c99562d8b` |
| `motion-showreel/assets/jetbrains-mono-medium.ttf` | 53332 | `c48f718d5d1cb6ada4c84d06c354c00fbb7bbe15d072974a13b48bad00443088` |
| `motion-showreel/assets/soundtrack.mp3` | 180916 | `04c3ddb8f08024ac35a1fc4be9e2ed604859039c5a3c57f4c93585afaa53532d` |
| `motion-ui-morph/assets/cover.jpg` | 3881 | `2804c45839b320463c761f8c812915f418b6d8919d32c3d72e4e3d74010e406b` |
| `motion-ui-morph/assets/geist-medium.ttf` | 35436 | `6a868615700d57f9bc0dd789a2748ff9bcc19bc17927695b998b01d4d0d22618` |
| `motion-ui-morph/assets/geist-regular.ttf` | 35404 | `e032eb160e81f82af36d5c0d3c8f6db940fbcbfe145b6f3ce8d7b0e49a570012` |
| `motion-ui-morph/assets/geist-semibold.ttf` | 35456 | `763d6d0717c5793f9d8c993eb098bf9c048b6c6462b48cf7c1dd905e47b854a4` |
| `motion-ui-morph/assets/soundtrack.mp3` | 168691 | `2dfacaac7bdc41cab4db549cbfdefd6ea875d4da383c7121aab21b5697d55ca3` |
| `motion-visual-lesson/assets/cover.jpg` | 26771 | `78817e6fd4b86633d622bb983d455485e2c12e1092898dc1a58c6654ca7602ee` |
| `motion-visual-lesson/assets/short-stack-regular.ttf` | 21516 | `1ce5921cb2a0ab31ebc64909597b022368b43c885c17c622f4433228b45eb163` |
| `motion-visual-lesson/assets/soundtrack.mp3` | 240789 | `1edb7ec6de8f0600c2d6a0e4212344fbd54bb81dac71100ec3ecf9d5cef1dc47` |

The gzip contains only the 669,884-byte Three.js r160 file, not a shell script
or native binary. Its uncompressed bytes match official `three@0.160.0`.
SHA-256: `170c6789f43217c96b3170f4b42fafe135de7f7cd48497a4218f9757ee1d49fa`.

Five `gsap.min.js` copies use 3.12.5, whereas scaffold uses the new 3.14.2
dependency. Official 3.12.5 is 72,214 bytes; each bundled copy is 72,212 bytes:
one trailing space in the license comment and one final blank line were removed.
The full executable JavaScript line matches. These are two deliberately
different runtime versions, not five additional npm dependencies.

`three-addons.js` uses **r185**, not r160: RoomEnvironment, FontLoader and
TextGeometry bodies are verbatim official r185 bodies with imports/exports
adapted to globals. The mixed versions merit compatibility testing, not a
malware allegation. The font-outline JavaScript is generated data and drawing
code; no installer or network execution was found in the template code.

The fonts have expected TrueType signatures and no table extending past the
file boundary under a minimal structural check. This is not OpenType sanitizer
validation. Their subset/instance-generation recipes and exact original Google
Fonts commits are not supplied, so upstream-byte matching is stronger than the
available original-font reproducibility evidence. Audio authorship is an
upstream claim; matching hashes cannot independently prove it.

## 6. Imported skill provenance and Python execution risks

All seven distinct claimed source commits were resolved through GitHub. This
verifies repository/commit availability, not the identity or security practices
of every community author:

| Material | Verified source revision | License evidence |
| --- | --- | --- |
| Animate | `emilkowalski/skills@e8a175de22ae1e49370fc144c1f3bb9aeedf988d` | Upstream MIT license; recipe file matches exactly. |
| Eight GSAP helpers | `greensock/gsap-skills@aed9cfd3277740755f6bfc1155c7aa645403b760` | Upstream MIT **skill-text** license, not GSAP runtime license. |
| UI Animation | `mblode/agent-skills@5a781a88ed60c1033767b6b6a966887cd93dd912` | MIT; original imported side files matched except trailing whitespace in one reference before this audit's setup-message edits. |
| Oil Motion | `oil-oil/oil-motion@07e31f2265f80caa8f2c1df825d85ac24a46307c` | MIT; imported script source verified; documented adaptations include dependencies/provider wording and FFmpeg option changes. |
| Huashu | `alchaincyf/huashu-art-motion@d861767d180008d27675819932070a670a3ae43f` | MIT at the pinned source; grouped reference/helper transformations were statically scanned, not exhaustively reconstructed. |
| Motion.Lab | `yangxu128/Motion.Lab@fbfda036aadbc1b46547bce8a7a57ec12bf73485` | README says MIT, but **no upstream LICENSE file**. Local license text was reconstructed. Obtain clearer permission/notice evidence or exclude it. |
| Motion Anything | `nexu-io/motion-anything@b016900d9ee92fc2d3e4dc520359cc8999d2ed4e` | Apache-2.0; all 17 CSS/JS implementation blocks across ten selected recipes match both declared hashes and pinned remote bytes exactly. |

There are 14 imported Python scripts: 11 Oil Motion and three UI Animation.
Static AST/import inspection found local media/math helpers and standard-library
filesystem/process calls, not credential clients or explicit upload clients.
`yaml.load` in `production_gate.py` uses a subclass of `yaml.SafeLoader`; it is
not the unsafe Python-object YAML loader despite the generic function name.

**Do not execute these helpers yet:**

- `motion_pipeline.py:78–85`: `--force` can recursively remove its selected
  output without project-root containment.
- `optimize_motion.py:50–63`: `--force` deletes an existing caller-selected
  directory/file, with no project containment or input-overlap protection.
- `loop_cleanup.py:44–63`: `--force` removes output contents; input=output can
  delete the source frames before reading them.
- `compile_scroll_video.py:601–655`: rejects filesystem root/home but not
  arbitrary important directories, input overlap or all symlink cases.
- `production_gate.py:71–92`: `--force` bypasses artifact hash/size mismatches;
  this is a verification override, not merely an overwrite flag.
- FFmpeg subprocesses use argument arrays rather than shell interpolation, but
  several media operations lack explicit protocol/demuxer restrictions and
  resource/time bounds. A local file path alone does not guarantee that a media
  demuxer cannot follow embedded external references.

Missing dependencies must be reported, not bootstrapped. Requirements need an
approved exact-version/hash lock and isolated environment first. For example,
the allowed `Pillow==10.0.0` has published findings including
[CVE-2023-4863 / GHSA-j7hp-h8jx-5ppr](https://github.com/advisories/GHSA-j7hp-h8jx-5ppr)
and [GHSA-3f63-hfp8-52jq](https://github.com/advisories/GHSA-3f63-hfp8-52jq).
This does not mean a fresh resolver would choose 10.0.0; it means the declared
range permits a known-vulnerable environment and is not an audited lock.

## 7. Telemetry, call-home and remote installers

### What the patch does and does not add

- The five new example HTML files reference bundled relative scripts, fonts and
  audio. No fetch/XHR/WebSocket/beacon/eval invocation was found in their authored
  code. Documentation URLs and SVG XML namespace strings are not network calls.
- `apps/daemon/src/media/index.ts` adds unconditional
  `HYPERFRAMES_NO_TELEMETRY=1` and `DO_NOT_TRACK=1` **after** inherited environment
  spread for the existing HyperFrames CLI subprocess.
- Reading installed HyperFrames 0.8.1 confirms those variables override telemetry
  configuration before capture. The package itself still contains a public
  PostHog project key, collection endpoints and default-enabled CLI telemetry.
- Its standalone Studio bundle also contains a PostHog batch/beacon client.
  That Studio is **not** the file OpenDesign injects for frame rendering.
- The actual injected `dist/hyperframe.runtime.iife.js` has no PostHog,
  `sendBeacon` or telemetry-enablement code. It does contain asset-related fetches;
  that does not make arbitrary user-authored compositions universally offline.
- Existing OpenDesign analytics implementation files remain in the repository;
  detached/no-call-home defaults are not synonymous with source-code removal.
  This patch does not modify those client/sink configuration implementations.
- No `.hyperframes` home directory was present when inspected, consistent with
  no CLI setup in this incident, but absence of this directory is not network
  forensics.

**No packet capture, historic process audit log or complete lifecycle transcript
exists for this incident. There is no observed telemetry event here, and there
is no defensible proof that zero outbound data was sent.** Public registry
requests are downloads/metadata traffic, not evidence of source-code exfiltration.

### Unsafe existing instructions and code

The docs contained remote shell pipes and PowerShell network-response execution
for Devin/DSH. These were pre-existing, **not added by the motion patch**, and
were not run by this session. They are supply-chain execution guidance, not by
themselves telemetry implementations. Those download-and-execute instructions
have been removed and replaced with explicit trust/approval requirements.

Static inspection also found these pre-existing executable risks, not silently
deleted or run during the audit:

- `tools/release/resources/dsh-bootstrap/install-dsh.sh`: downloads Node and
  installs DSH/pnpm with npm (lifecycle scripts enabled); it can launch DSH's Web
  UI. A Node checksum downloaded from the same origin is not an independent
  signature, and `--before` is not a hash-locked dependency graph. No explicit
  telemetry upload was found in the shell script itself; downloaded tools need
  their own audit. It is **not connected to the root postinstall**.
- `scripts/install-unsafe-dmg.sh`: arbitrary supplied DMG URL, no pinned digest
  or signature verification, installs to `/Applications`, and strips quarantine,
  provenance and macl attributes. Root instructions now prohibit using it as a
  setup/validation workaround. The script remains a separately actionable
  implementation risk, not an approved procedure.
- Existing daemon adapters include headless auto-approval flags (Claude,
  CodeBuddy, Devin, Amp and others). These are broader runtime trust decisions,
  not newly introduced motion dependencies and not authority for this host
  session to bypass its own approval controls. Reworking them requires a scoped
  product change and validation; this audit does not pretend that editing prose
  removes their runtime behavior.

## 8. Additional media/security boundary review

Positive controls in the patch include audio `realpath` containment, numeric
timing/volume checks, a 32-track cap, explicit supported audio demuxers and
`file,pipe` protocol restriction during audio encoding, MP4 link/output matching,
and iframe message-source checks. Preview CSP only adds local/data fonts; it
retains `connect-src 'none'`. It does not introduce a wildcard network policy.

Outstanding static findings, **not dynamically exploited**:

1. `chat-artifacts/motion-cover.ts:58–65` invokes FFmpeg on project-selected
   `.mp4` bytes without forcing the MOV/MP4 demuxer or restricting input
   protocols. Filename containment is not content containment: FFmpeg supports
   playlists and external references. Add fail-closed content/protocol policy
   and a regression before accepting arbitrary project media.
2. `artifacts/motion-delivery.ts:21–25` reads source bytes before its containment
   check, and returns early for unmarked content. Move containment before reads
   regardless of marker; current caller's lexical composition check is not a
   complete symlink boundary. Avoid conflating this with a demonstrated secret
   exfiltration exploit.
3. Snapshot-time source/media checks and later reads have normal filesystem
   TOCTOU windows. Existing project-file containment needs race-aware treatment
   if hostile concurrent writers are part of the threat model.
4. Media parsing/rendering is not made safe solely by an authenticated npm
   package. Decoder versions, resource bounds and browser isolation remain
   execution prerequisites. No browser or FFmpeg was launched for this audit.

## 9. License/source review still required

- [GSAP's actual license](https://gsap.com/community/standard-license/) permits
  ordinary commercial and AI-generated code, but restricts competitive visual
  animation-builder uses. It is not OSI MIT/Apache licensing. This patch says it
  does not add a graphical editor, which is relevant, but product use and
  redistribution still need an explicit maintainer/legal decision. Do not infer
  permission from the MIT license of the separate GSAP skill text.
- Three.js is MIT. The new plugin asset directory carries copyright/license
  pointers in JavaScript, but no complete Three.js MIT text. Preserve the full
  required notices with copied runtime/add-on material, not an Apache-only
  manifest assertion.
- Font OFL files are supplied. The Short Stack license reserves its family name
  while the subset still identifies as Short Stack. Confirm modification/name
  permissions or use a demonstrably compliant original/renamed derivative;
  this report is a compliance concern, not a final legal determination.
- Motion.Lab's reconstructed MIT file needs clearer upstream grant/attribution
  evidence. A source commit existing is not an independent rights clearance.
- Viral-post recreation and “original soundtrack” claims are documented upstream,
  not independently licensed/author-confirmed by this audit. Social popularity
  is not a redistribution license.

## 10. Instruction remediation performed

- Removed both root install-after-manifest-change mandates and the install
  command from the common-command list.
- Added an explicit audit/patch-only execution boundary, approval requirements
  for installs/scripts/toolchain acquisition, missing-tool stop behavior,
  version/source/hash/destination review and prohibition on automatic fallbacks.
- Removed the mirrored mandatory-install rule in code-review guidance, the
  contributor bootstrap block and two stale Tailwind spec mandates.
- Removed `curl | sh`/`curl | bash`, remote PowerShell evaluation and immediate
  CMD download/execution recommendations from active adapter/DSH docs.
- Removed TLS revocation-check bypasses from packaging instructions, removed
  the recommended no-sandbox fallback, and required scoped approval for cleanup;
  product-user-data deletion flags are no longer in the cleanup examples.
- Replaced “stash or check out upstream” baseline guidance with read-only or
  explicitly approved isolated baseline handling.
- Added imported-skill trust boundaries. Oil Motion no longer instructs automatic
  isolated pip setup and warns against destructive/hash-bypassing `--force`.
- Removed unpinned pip/Brew/sudo setup hints from the three UI measurement
  scripts; missing dependencies now explicitly stop. Source-adaptation notices
  record these small message/instruction changes.
- A wider skill/template sweep also removed the two bundled HTML-PPT skill
  installer commands, GSAP/React automatic setup guidance, floating shadcn CLI
  examples, and the Taste skills' unpinned installation mandates/command appendix.
  Package identities remain as reference, not installation authorization.
- Added the same trust/approval boundary to plugin and template author guidance.
  Checked `CLAUDE.md` (which only imports `AGENTS.md`) and tracked hidden
  `.opencode` command/skill guidance; no additional automatic-install mandate
  was found there. No external/global host configuration was modified.
- Corrected the inherited DSH guide's claim that this fork automatically
  publishes/trusts upstream bootstrap scripts; it does not ship that workflow.

These are guidance/message changes, not enforcement of a new OS sandbox and not
removal of the existing root postinstall hook. Separating installation from
compilation at the package-script level remains a proposed follow-up, not an
unannounced manifest/lifecycle rewrite.

## 11. Required decisions before any further execution

1. Approve a researched package-manager version not affected by the listed
   advisories; do not auto-update/install it.
2. Decide whether to accept GSAP's non-MIT runtime terms and address the remaining
   vendor/font/community-material notice questions.
3. Exclude or harden Oil Motion's dangerous output/`--force` paths, and approve a
   hash-pinned Python environment only if those optional helpers are needed.
4. Resolve the media-content/protocol and read-before-containment findings.
5. Decide whether third-party telemetry-bearing CLI/Studio code is acceptable
   when disabled/unreachable, or must be removed from the shipped payload.
6. Review a concrete command plan before any install, script, build, test or
   application launch. A scripts-disabled, frozen-lockfile install still needs
   download approval and does not authorize later lifecycle execution.
7. Approve any cleanup separately. Installed GSAP, generated outputs and caches
   have been left intact rather than deleting evidence or pre-existing work.

No tests, guard, typecheck or visual checks were run during this audit. The
existing install-triggered builds are incident evidence, not approved validation
or proof that the motion feature works.

## Local evidence files

Full machine-readable inventories and API responses are retained under
`.tmp/motion-security-audit/` (ignored local audit evidence, not runtime data):

```text
patch-inventory.json
manifest-deltas.json
incident-filesystem-evidence.json
workspace-build-script-inventory.json
installed-lifecycle-inventory.json
sanitized-package-manager-config.json
npm-provenance-and-advisories.json
npm-registry-signing-keys.json
npm-signature-results.json
upstream-release-commit.json
upstream-binary-comparisons.json
skill-source-commits.json
skill-sidefile-source-comparisons.json
motion-anything-code-hash-verification.json
three-addon-source-checks.json
optional-python-dependencies.json
hyperframes-existing-dependency.json
third-party-network-static-scan.json
template-resource-references.json
font-structure-and-names.json
static-scan.json
external-domains.json
agent-instruction-inventory.json
final-instruction-sweep.json
```

The initial patch inventory intentionally records the original applied bytes;
subsequent audit remediation changes are separate and uncommitted. Some globbed
template inventories also include the pre-existing `motion-frames` example;
it is not counted among the five new examples or 28 binary additions.
