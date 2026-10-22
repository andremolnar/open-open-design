import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_PENDING = 48;
const MAX_IMAGES = 256;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const PNG_MAGIC = Buffer.from('89504e470d0a1a0a', 'hex');
export interface ProjectThumbnailSource { html: string; revision: string; }
export interface ProjectThumbnailImage { bytes: Buffer; etag: string; }

/** One bounded render lane, including source assembly, with persistent,
 * content-addressed PNGs. Never free the lane merely because a caller left:
 * the actual renderer must have stopped before another capture can start. */
export function createProjectThumbnailCache(options: {
  dataRoot: string;
  render: ((html: string) => Promise<Buffer>) | null;
}) {
  const directory = join(options.dataRoot, 'project-preview-thumbnails');
  const pending = new Map<string, Promise<ProjectThumbnailImage>>();
  let tail: Promise<unknown> = Promise.resolve();
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const valid = (bytes: Buffer) => bytes.length > 8 && bytes.length <= MAX_IMAGE_BYTES && bytes.subarray(0, 8).equals(PNG_MAGIC);

  async function prune() {
    const entries = await readdir(directory);
    const names = entries.filter(name => /^[a-f0-9]{64}\.png$/.test(name));
    if (names.length <= MAX_IMAGES) return;
    const images = await Promise.all(names.map(async name => ({ name, mtime: (await stat(join(directory, name))).mtimeMs })));
    images.sort((a, b) => b.mtime - a.mtime);
    await Promise.all(images.slice(MAX_IMAGES).map(entry => rm(join(directory, entry.name), { force: true })));
  }

  async function capture(input: { identity: string; read(): Promise<ProjectThumbnailSource> }): Promise<ProjectThumbnailImage> {
    const source = await input.read();
    const key = hash(JSON.stringify(['project-thumbnail-v1', input.identity, source.revision]));
    const path = join(directory, `${key}.png`);
    const etag = `"${key}"`;
    try {
      const bytes = await readFile(path);
      if (valid(bytes)) {
        const now = new Date();
        await utimes(path, now, now);
        return { bytes, etag };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!options.render) throw new Error('thumbnail renderer unavailable');
    const bytes = await options.render(source.html);
    if (!valid(bytes)) throw new Error('thumbnail renderer returned an invalid PNG');
    if ((await input.read()).revision !== source.revision) throw new Error('page changed during capture');
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `${key}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, bytes, { flag: 'wx' });
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }); }
    await prune();
    return { bytes, etag };
  }

  return {
    get(input: { identity: string; read(): Promise<ProjectThumbnailSource> }): Promise<ProjectThumbnailImage> {
      const existing = pending.get(input.identity);
      if (existing) return existing;
      if (pending.size >= MAX_PENDING) return Promise.reject(new Error('thumbnail queue is full'));
      const job = tail.then(() => capture(input));
      pending.set(input.identity, job);
      tail = job.catch(() => {});
      void job.finally(() => { if (pending.get(input.identity) === job) pending.delete(input.identity); }).catch(() => {});
      return job;
    },
  };
}
