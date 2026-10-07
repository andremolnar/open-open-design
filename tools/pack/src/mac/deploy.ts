import { execFile } from "node:child_process";
import { lstat, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ToolPackConfig } from "../config/index.js";
import { packMac } from "./build.js";
import { resolveMacInstallIdentity } from "./identity.js";
import { stopPackedMacApp } from "./lifecycle.js";

const execFileAsync = promisify(execFile);
const APPLICATIONS_ROOT = "/Applications";

async function entryType(path: string): Promise<"directory" | "other" | "missing"> {
  try {
    const entry = await lstat(path);
    return entry.isDirectory() ? "directory" : "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

/** Never replace a manually installed app unless its embedded namespace and bundle ID match. */
export async function assertMatchingMacApp(
  appPath: string,
  namespace: string,
  appId: string,
): Promise<void> {
  if (await entryType(appPath) !== "directory") {
    throw new Error(`not an app bundle directory: ${appPath}`);
  }
  const configPath = join(appPath, "Contents", "Resources", "open-design-config.json");
  let installedNamespace: unknown;
  let installedAppId: string;
  try {
    installedNamespace = (JSON.parse(await readFile(configPath, "utf8")) as { namespace?: unknown }).namespace;
    const { stdout } = await execFileAsync("/usr/libexec/PlistBuddy", [
      "-c", "Print :CFBundleIdentifier", join(appPath, "Contents", "Info.plist"),
    ]);
    installedAppId = stdout.trim();
  } catch {
    throw new Error(`cannot verify existing app identity at ${appPath}; refusing to replace it`);
  }
  if (installedNamespace !== namespace || installedAppId !== appId) {
    throw new Error(`existing app at ${appPath} has a different namespace or bundle ID; refusing to replace it`);
  }
}

async function verifyLocalSignature(appPath: string): Promise<void> {
  await execFileAsync("codesign", ["--verify", "--deep", "--strict", appPath]);
  const { stderr } = await execFileAsync("codesign", ["-dv", "--verbose=4", appPath]);
  if (!stderr.split("\n").some((line) => line.startsWith("Authority=Apple Development:"))) {
    throw new Error(`expected an Apple Development signature on ${appPath}`);
  }
}

/** Build a local signed app and install it without touching any daemon-managed data. */
export async function deployLocalMacApp(
  config: ToolPackConfig,
  applicationsRoot = APPLICATIONS_ROOT,
): Promise<{ installedAppPath: string; namespace: string }> {
  if (process.platform !== "darwin") throw new Error("mac deploy requires macOS");
  if (!config.portable || !config.signed || config.to !== "app" || config.macNotarize) {
    throw new Error("mac deploy requires a portable, signed, unnotarized app build");
  }
  const identity = resolveMacInstallIdentity(config);
  // A local deploy must never take over a public release-channel app's name.
  if (identity.systemAppBundleName === identity.publicAppBundleName) {
    throw new Error("mac deploy requires a local namespace, not a release-channel identity");
  }

  const built = await packMac(config);
  await verifyLocalSignature(built.appPath);
  if (await entryType(applicationsRoot) !== "directory") {
    throw new Error(`Applications directory not available: ${applicationsRoot}`);
  }

  const installedAppPath = join(applicationsRoot, identity.systemAppBundleName);
  const previous = await entryType(installedAppPath);
  if (previous === "other") throw new Error(`refusing to replace non-directory: ${installedAppPath}`);
  if (previous === "directory") {
    await assertMatchingMacApp(installedAppPath, config.namespace, identity.appId);
  }

  // Stage on the destination volume; rename only after ditto and codesign succeed.
  const stage = await mkdtemp(join(applicationsRoot, `.${identity.systemAppBundleName}.stage-`));
  const stagedApp = join(stage, identity.systemAppBundleName);
  let backup: string | null = null;
  let preserveStage = false;
  try {
    await execFileAsync("ditto", [built.appPath, stagedApp]);
    await verifyLocalSignature(stagedApp);
    const stopped = await stopPackedMacApp(config);
    if (stopped.remainingPids.length > 0) {
      throw new Error(`cannot replace a running app (${stopped.remainingPids.join(", ")})`);
    }
    // Recheck immediately before replacement; another installer might have changed the destination.
    const current = await entryType(installedAppPath);
    if (current !== previous) {
      throw new Error(`app destination changed during deployment: ${installedAppPath}`);
    }
    if (current === "directory") {
      await assertMatchingMacApp(installedAppPath, config.namespace, identity.appId);
      backup = join(stage, "previous.app");
      await rename(installedAppPath, backup);
    }
    try {
      await rename(stagedApp, installedAppPath);
    } catch (error) {
      if (backup !== null) {
        try {
          await rename(backup, installedAppPath);
        } catch (rollbackError) {
          // Retain the staged old bundle for manual recovery if rollback itself fails.
          preserveStage = true;
          throw new Error(`deployment failed and previous app remains in ${stage}`, { cause: rollbackError });
        }
      }
      throw error;
    }
    // Only the verified old bundle is removed; never remove product data.
    return { installedAppPath, namespace: config.namespace };
  } finally {
    if (!preserveStage) await rm(stage, { recursive: true, force: true });
  }
}
