# Release note source contract

## Fork releases — 1.0.0 onward

This fork's product versions start at **1.0.0**. The first fork release collects
all fork-owned changes since the upstream baseline recorded in the root
[CHANGELOG](../../CHANGELOG.md#fork-release-history). Its sources are
[`v1.0.0/en.md`](v1.0.0/en.md) and [`v1.0.0/zh-CN.md`](v1.0.0/zh-CN.md).
It is **in preparation**; these files do not publish a release or establish a
publication date. See [CONTRIBUTING](../../CONTRIBUTING.md#fork-versioning-and-release-notes)
for the versioning policy.

## Pre-fork history — inherited 0.x versions

The existing `v0.*` notes are inherited from the original project. Their version
numbers, text, links, and contributor credits are retained for history and
attribution; they do not announce releases by this fork's maintainer. They are
not renamed or renumbered into the fork's release sequence.

## Source format

Release note content is stored under `docs/CHANGELOG/v<releaseVersion>/<locale>.md`.
The directory name must contain the exact full release version, including its
channel and counter when present. There is no fallback to a base version.

Each locale file must:

- use a canonical BCP 47 locale as its filename, such as `en.md` or `zh-CN.md`;
- be valid UTF-8 Markdown no larger than 1 MiB;
- begin with YAML front matter containing non-empty `title` and `description`
  strings; and
- contain a non-empty Markdown body after the front matter.

The `en` locale is required whenever a release-note directory is supplied,
because every consumer falls back to it. Everything else is a recommendation,
not a gate: any channel may omit the version directory entirely, and a stable
release that is missing its notes — or missing `zh-CN` — can still publish.
There is no GitHub Actions warning or job summary; the release operator must
review any missing locales before publication. Stable releases are expected to
ship `en` and `zh-CN`.

`tools-release` retains the front matter in the uploaded file and publishes it
as an immutable object at
`<channel>/versions/<releaseVersion>/release-notes/<locale>.md`. Public release
metadata contains only locale transport descriptors (`url`, `mediaType`,
`sha256`, and `size`); render fields are read from the content itself.
