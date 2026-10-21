import { join } from 'node:path';

/** better-sqlite3 13 ships stable Node-API binaries, not Electron ABI rebuilds. */
export function sqliteRuntimePath(appRoot: string, platform: 'darwin' | 'win32', arch: string): string {
  if (arch !== 'arm64' && arch !== 'x64') throw new Error(`Unsupported SQLite runtime architecture: ${arch}`);
  return join(appRoot, 'node_modules', 'better-sqlite3', 'prebuilds', `${platform}-${arch}.node`);
}
