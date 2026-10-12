# Post-update "What's New" card

After a new build is installed manually or the web app reloads, the Home surface
can show a one-time bottom-right card: a title, short
copy, an optional image, and a "See what's new" link. It is best-effort chrome —
if the source is unreachable or empty, no card shows and Home is unaffected.

## Where the content lives

The card content is a single hand-curated JSON document, kept in this
repository at:

```
docs/whats-new.json
```

The former hosted document URL is:

```
https://whatsnew.open-design.ai/whats-new.json
```

Editing this repository file does not publish it. Publishing requires a separate, explicitly authorized operation with appropriate credentials. The content is **not**
carried in release `metadata.json`, and there is no per-release publish
tooling: one file, edited when the copy should change.

- The daemon proxies it at `GET /api/whats-new` (also `od whats-new [--json]`),
  so the web UI and CLI read the exact same payload.
- No release channel fetches hosted highlights automatically. Without an
  explicitly configured document URL, the API returns no card and Home makes
  no outbound highlights request.
- `OD_WHATS_NEW_URL` opts a deployment into a document (for example a local
  `tools-serve` fixture). Set it explicitly to preview the card on a dev build.

## Show-once behavior

The card is driven by **content identity**, not the app version. The document
carries an `id`; the client remembers the last `id` it showed and only opens the
card when the current `id` differs. So:

- Change `id` whenever you want the card to re-appear (e.g. set it to the new
  release version).
- Leaving `id` unchanged means users who already saw it will not see it again.
- A fresh profile that has never seen the current `id` shows the card once — the
  document is deliberately curated, so surfacing the current highlight to a new
  user once is intended.

To retire the card entirely, publish an empty object (`{}`); the daemon then
resolves to "no highlight". Any *other* incomplete document also resolves to
"no highlight", but that is the accident case, not the intended one — the guard
accepts only a complete highlight or the empty document, so taking the card
down is an explicit act rather than something a typo can do for you.

## Document schema

```json
{
  "id": "0.13.0",
  "title": "Design system sync",
  "body": "Import, edit and sync design systems with cleaner release highlights on Home.",
  "imageUrl": "https://whatsnew.open-design.ai/0.13.0.png",
  "linkUrl": "https://github.com/nexu-io/open-design/releases/tag/open-design-v0.13.0",
  "ctaLabel": "View release notes",
  "locales": {
    "zh-CN": {
      "title": "设计系统同步",
      "body": "在首页导入、编辑并同步设计系统，发布亮点更清晰。",
      "linkUrl": "https://open-design.ai/zh/blog/0-13-0/",
      "ctaLabel": "查看更新说明"
    }
  }
}
```

Field rules — anything missing or malformed makes the card silently not show,
which is why `pnpm guard` checks the repository document against the shipping
parser rather than trusting review:

- `id` — **required**, non-empty string. The show-once key.
- `title`, `body` — **required**, non-empty strings.
- `imageUrl` — optional, must be `https:`. Omitted → text-only card.
- `linkUrl` — optional, must be `https:`. Omitted → no external CTA; this fork
  never falls back to the original project's release index.
- `ctaLabel` — optional, non-empty plain-text button label. Omitted → the
  client's localized release-notes label. Clients predating this field ignore
  it and keep their built-in label; they need a client update to support it.
- `locales` — optional per-locale overrides keyed by app locale id (`en`,
  `zh-CN`, …); each may override `title`/`body`/`linkUrl`/`ctaLabel`. An exact locale wins,
  then the bare language (`zh` for `zh-TW`), then the base fields.

## Updating the card

1. Edit `docs/whats-new.json` and run `pnpm guard` locally. The guard
   (`scripts/check-whats-new-document.ts`) runs the document through the
   daemon's shipping parser and catches malformed or silently dropped fields.
2. Have a maintainer review the copy and content `id`. Editing or merging this
   file does **not** upload it. There is no repository-owned publisher or
   GitHub Actions secret boundary.
3. If the card should go live, publish the reviewed JSON separately through
   an authorized storage process and verify the served bytes. The hosted
   object is shared across channels, so an older copy can replace a newer one.

`OD_WHATS_NEW_URL` must be set for a deployment to request highlights. Once
published, allow for object caching and the daemon's in-process cache before
expecting clients to see a change. Do not place publishing credentials in this
repository or rely on a pull-request check to approve a publication.
