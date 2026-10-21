# Source and adaptation

- Upstream: https://github.com/oil-oil/oil-motion/tree/07e31f2265f80caa8f2c1df825d85ac24a46307c
- Commit: `07e31f2265f80caa8f2c1df825d85ac24a46307c`
- License: MIT; see LICENSE.

## Open Design changes

- Preserved all local media processing scripts, controller assets and relevant reference guides.
- Replaced provider-specific generation and credential setup with host tools; excluded upstream image/video clients and credential UI.
- requirements.txt contains only local processing dependencies; no credential dependency.
- Adapted entrypoint, prompting and Alpha QA wording; normalized trailing whitespace.
- Demo media, README art, standalone service tests and credential configuration are not shipped.
- Replaced removed FFmpeg `-vsync 0` with output-scoped `-fps_mode passthrough` in frame extraction; requires FFmpeg with fps_mode support, as does the upstream compiler; verified with FFmpeg 9.0.1.
- Security-audit follow-up: the host adapter now requires explicit approval for
  dependency setup and for destructive/verification-bypassing `--force` use.
  The imported scripts remain unauthorised for execution pending
  output-containment hardening and explicit host approval.
- Dependency follow-up (2026-10-21): pinned Pillow 13.0.0, NumPy 2.5.4 and
  PyYAML 6.0.3 using official PyPI metadata; OSV returned no matches for those
  versions. This raises the dependency baseline to Python 3.12+. No Python
  package was installed or imported for the review; compatibility is untested.
- Included a platform-specific CPython 3.14/macOS arm64 binary-only lock using
  official PyPI wheel SHA-256 metadata; the generic requirements keep the same
  exact versions. No claim of cross-platform artifact verification is made.
