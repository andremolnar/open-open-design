# Source and adaptation

- Upstream: https://github.com/mblode/agent-skills/tree/5a781a88ed60c1033767b6b6a966887cd93dd912/skills/ui-animation
- Commit: `5a781a88ed60c1033767b6b6a966887cd93dd912`
- Author and license: see the bundled MIT `LICENSE`. This license covers the
  skill material; runtime libraries and external assets retain their own terms.

## Open Design changes

- Added localized catalogue metadata, search triggers, functional mode, and host
  execution constraints.
- Bundled all 18 runtime references and all three measurement scripts; removed
  a trailing blank line in gesture-drag.md without changing its content.
- Clarified capability checks, isolated dependencies, truthful degradation, and
  fresh output directories; no automatic global dependency installation.
- Excluded upstream eval fixtures and replaced their runtime maintenance note.
- Security-audit follow-up: removed unpinned pip/global-package-manager setup
  hints from the three scripts and made missing dependencies an explicit blocker.
  Measurement implementations are otherwise unchanged; no script was run for
  this audit.
- Dependency follow-up (2026-10-21): added explicit NumPy 2.5.4, SciPy 1.18.1
  and opencv-python 5.0.0.93 requirements from official PyPI metadata, with no
  OSV matches at review time. These require Python 3.12+; compatibility remains
  untested. Installation needs approval and hash-verified binary wheels in an
  isolated environment, not an implicit pip/source-build fallback.
- Included a platform-specific CPython 3.14/macOS arm64 binary-only lock using
  official PyPI wheel SHA-256 metadata, including OpenCV's macOS 13+ baseline.
  The generic requirements keep the same exact versions; other platforms need
  separately reviewed wheel hashes.
