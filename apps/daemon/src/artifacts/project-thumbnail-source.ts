import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { injectMotionSourcePlayer, isMotionVideoComposition } from '@open-design/contracts/runtime/motion-source-player';
import { listFiles, resolveProjectDir, resolveProjectFilePath } from '../projects.js';
import { bundleStandaloneHtml } from './standalone-html.js';
import type { ProjectThumbnailSource } from '../services/project-thumbnail-cache.js';

/** Background covers never acquire credentials, use a live project origin or
 * fetch remote scripts/assets. Only the verified, inlined local graph is sent
 * to the sandboxed renderer. Hover/open still use the ordinary live page. */
const CAPTURE_POLICY = "default-src 'none'; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

export async function freezeProjectThumbnailSource(input: {
  projectsRoot: string;
  projectId: string;
  fileName: string;
  metadata?: unknown;
  html?: string;
}): Promise<ProjectThumbnailSource> {
  const root = await realpath(resolveProjectDir(input.projectsRoot, input.projectId, input.metadata));
  const witnesses = new Map<string, { ino: number; dev: number; size: number; mtimeMs: number }>();
  const contained = (name: string) => {
    const relative = path.relative(root, name);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  const read = async (name: string) => {
    // This is the same canonical-path and imported-folder visibility gate as
    // /raw. Do not substitute a lexical startsWith check for real containment.
    const file = await resolveProjectFilePath(input.projectsRoot, input.projectId, name, input.metadata);
    const before = await stat(file.filePath);
    if (!before.isFile() || before.size > MAX_SOURCE_BYTES) throw new Error('invalid thumbnail source');
    const handle = await open(file.filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev || !contained(await realpath(file.filePath))) throw new Error('thumbnail source changed');
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 })) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > MAX_SOURCE_BYTES) throw new Error('thumbnail source exceeds size limit');
        chunks.push(bytes);
      }
      const after = await handle.stat();
      if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error('thumbnail source changed');
      witnesses.set(file.filePath, after);
      return { file, bytes: Buffer.concat(chunks) };
    } finally { await handle.close(); }
  };
  const html = input.html ?? (await read(input.fileName)).bytes.toString('utf8');
  if (Buffer.byteLength(html) > MAX_SOURCE_BYTES) throw new Error('thumbnail source exceeds size limit');
  const bundled = await bundleStandaloneHtml({
    entryPath: input.fileName,
    html: isMotionVideoComposition(html) ? injectMotionSourcePlayer(html) : html,
    readAsset: async name => {
      const { file, bytes } = await read(name);
      return { buffer: bytes, mime: file.mime, size: bytes.length };
    },
  });
  // Include the visible file manifest for scripts that dynamically refer to
  // local assets the static bundler cannot discover. Conservative invalidation
  // is preferable to a stale screenshot after an image/font/data-only edit.
  const files = await listFiles(input.projectsRoot, input.projectId, { metadata: input.metadata });
  const manifest = files.map(file => [file.path ?? file.name, file.size, file.mtime]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  for (const [name, expected] of witnesses) {
    const current = await stat(name);
    if (!contained(await realpath(name)) || current.ino !== expected.ino || current.dev !== expected.dev || current.size !== expected.size || current.mtimeMs !== expected.mtimeMs) throw new Error('thumbnail source changed');
  }
  const $ = load(bundled.html);
  $('meta[http-equiv="refresh" i],base').remove();
  $('audio,video').removeAttr('autoplay').attr('muted', '');
  // Prepend before authored head scripts so the policy applies immediately.
  $('head').prepend($('<meta>').attr('http-equiv', 'Content-Security-Policy').attr('content', CAPTURE_POLICY));
  if (isMotionVideoComposition(html)) {
    $('head').prepend('<script>window.__odMotionThumbnail = true;</script>');
    $('body').append(`<script>
      function poster() {
        var root = document.querySelector('[data-composition-id]');
        var player = window.__odMotionPlayer;
        if (root && player) {
          var time = Number(root.getAttribute('data-poster-time') || 0);
          player.seek(Number.isFinite(time) ? time : 0);
        }
      }
      document.addEventListener('DOMContentLoaded', poster);
      window.addEventListener('load', poster);
    </script>`);
  }
  const capturedHtml = $.html();
  const revision = createHash('sha256').update(JSON.stringify([root, input.fileName, capturedHtml, manifest])).digest('hex');
  return { html: capturedHtml, revision };
}
