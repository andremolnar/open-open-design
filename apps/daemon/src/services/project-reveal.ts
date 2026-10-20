import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export class ProjectRevealError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Native reveal may target only an existing file/directory inside this project,
 * including after symlink resolution. Never accept an absolute host path. */
export async function resolveProjectRevealPath(projectDir: string, relativePath: unknown): Promise<{ target: string; projectRoot: boolean }> {
  if (relativePath !== undefined && typeof relativePath !== 'string') {
    throw new ProjectRevealError(400, 'path must be a project-relative string');
  }
  const name = relativePath ?? '';
  if (name.includes('\0') || name.includes('\\') || path.posix.isAbsolute(name)
    || path.win32.isAbsolute(name) || name.includes(':') || name.split('/').includes('..')) {
    throw new ProjectRevealError(400, 'path must stay inside the project');
  }
  try {
    const root = await realpath(projectDir);
    const target = await realpath(path.resolve(root, name));
    const relative = path.relative(root, target);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new ProjectRevealError(403, 'path resolves outside the project');
    }
    const info = await stat(target);
    if (!info.isDirectory() && !info.isFile()) {
      throw new ProjectRevealError(400, 'only files and folders can be revealed');
    }
    return { target, projectRoot: relative === '' };
  } catch (error) {
    if (error instanceof ProjectRevealError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') {
      throw new ProjectRevealError(404, 'project file or folder is not available locally');
    }
    throw new ProjectRevealError(500, 'could not resolve the local project path');
  }
}
