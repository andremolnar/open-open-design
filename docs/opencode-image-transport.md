# OpenCode image transport

## Daemon-to-CLI attachment contract

The OpenCode and BYOK OpenCode runtime definitions pass each validated image
path to the external CLI as a separate `--file`, `absolutePath` argv pair.
Paths containing spaces, Unicode, or shell punctuation stay one argument;
the adapters do not shell-quote them or embed the prompt in argv.

The composed prompt still travels through stdin. Existing model selection,
capability-gated `--auto`, standalone execution, and ordinary OpenCode's
captured-session `-s` behavior are unchanged. BYOK retains its existing session
behavior. Validation and selection of the attachment paths remain owned by the
daemon caller, not the runtime argument builder.

Previously both argument builders ignored `imagePaths`. A textual `@path`
reference in the prompt does not by itself attach image bytes to the initial
model input. The CLI could independently use a file-reading tool later, but that
is a separate action and is not evidence that the initial request contained an
image. Explicit CLI attachments close this transport gap.

## Pinned upstream evidence

The source trace below is for OpenCode V2 **2.0.18**, commit
`cd9a14a6b688d4021bee381dfd39d2cef9c0f862`, matching this daemon's pinned
`@opencode/client` dependency. It is source evidence, not verification of a
user's installed CLI or of a particular model's visual understanding.

1. The [run command schema](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/cli/src/commands/commands.ts#L386-L390)
   accepts repeated `--file` / `-f` values, up to 100.
2. The [run implementation](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/cli/src/run/run.ts#L71-L80)
   reads stdin as text separately from the explicit file list.
   [`prepareFile`](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/cli/src/run/run.ts#L185-L215)
   reads a regular file, rejects inputs larger than 10 MiB, determines its MIME
   type, and produces a base64 data URL.
3. The [noninteractive prompt submission](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/cli/src/run/noninteractive.ts#L667-L678)
   carries attachments in `prompt.files`, independently of `prompt.text`.
4. The [session prompt materializer](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/core/src/session/prompt.ts)
   consumes those explicit files. User-image normalization defaults to
   [2000 by 2000 pixels and 5 MiB of base64](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/core/src/image.ts#L59-L69),
   with automatic resizing enabled. The resulting provider payload is therefore
   not guaranteed to preserve the original image bytes.
5. Provider adapters lower image media to native image inputs, for example
   [Anthropic base64 image blocks](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/ai/src/protocols/anthropic-messages.ts#L750-L765)
   and [Open Responses input images](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/ai/src/protocols/open-responses.ts#L507-L536).

The subprocess remains an external OpenCode session. Forwarding image files
does not turn delegated generation into work performed by the calling coding
session. Host-owned design workflows and MCP image responses are separate
transport paths and need their own content, capability, and size checks.

## Verification

The focused regression suite is
`apps/daemon/tests/runtimes/opencode-image-args.test.ts`. It checks both adapters
with a spaced path, multiple images, literal Unicode/shell characters, empty
inputs, text-only path mentions, model selection, permission capability, and
ordinary OpenCode session resume. It also checks that prompts remain on stdin.
Run it from `apps/daemon` using the repository's pinned toolchain:

```sh
pnpm exec vitest run -c vitest.config.ts tests/runtimes/opencode-image-args.test.ts
```

These tests establish the daemon's argv contract. They do not start a provider
request or prove image perception. A live acceptance check should record the
installed OpenCode version, provider/model, image capability, and any relevant
image-size settings; submit a small test image with visual facts absent from the
prompt and filename; then verify both attachment delivery and those facts in
the response. Repeat with two distinct images and on an ordinary OpenCode
follow-up session. Report missing attachment support, a text-only model, or
provider rejection explicitly rather than treating a filename mention as
success.
