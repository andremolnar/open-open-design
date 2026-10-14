# Translating this fork

The original OpenDesign contributors translated many guides and UI strings. Thank you to those [upstream translation contributors](https://github.com/nexu-io/open-design/graphs/contributors). This fork's English [README](README.md), [Quickstart](QUICKSTART.md), [contribution guide](CONTRIBUTING.md), and [maintainer note](MAINTAINERS.md) are now the source of truth. The inherited translations under `docs/i18n/` currently redirect to those guides because their upstream pricing, releases, governance, and roadmap do not describe this fork. Their original wording remains available in Git history.

## Restoring a translation

1. Choose a guide and a language. Translate from the **current English fork guide**, not from the old upstream translation or an upstream website.
2. Save it under `docs/i18n/` as `README.<language>.md`, `QUICKSTART.<language>.md`, `CONTRIBUTING.<language>.md`, or `MAINTAINERS.<language>.md`. Use relative links from `docs/i18n/` (for example, `../../README.md`).
3. Keep product names, commands, environment variables, code samples, and the distinction between this fork and upstream intact. Do not carry over upstream Cloud offers, releases, Fellow programs, review guarantees, or roadmap promises.
4. Check all links and compare the result with the English source before opening a PR on [this fork](https://github.com/andremolnar/open-open-design/pulls). If you cannot verify a translated claim, link to the English guide instead.

The web UI uses separate, fully typed dictionaries under `apps/web/src/i18n/locales/`. When changing UI translations, keep keys and placeholders aligned with `en.ts`, update the locale registration where needed, and run `pnpm --filter @open-design/web typecheck` and the focused i18n tests. Do not translate executable skills, design-system source, or agent prompt bodies as a substitute for UI localization.

There is no dedicated translation team or guaranteed review schedule for this fork. Questions and corrections belong in [this fork's issues](https://github.com/andremolnar/open-open-design/issues).
