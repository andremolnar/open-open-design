import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ToolPackConfig } from "@/config/index.js";
import { assertMatchingMacApp, deployLocalMacApp } from "@/mac/deploy.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeApp(namespace: string, appId = "io.open-design.desktop"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "od-deploy-test-"));
  roots.push(root);
  const app = join(root, "Open Design.local-smoke.app");
  const contents = join(app, "Contents");
  await mkdir(join(contents, "Resources"), { recursive: true });
  await writeFile(join(contents, "Resources", "open-design-config.json"), JSON.stringify({ namespace }));
  await writeFile(join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${appId}</string></dict></plist>\n`);
  return app;
}

describe.skipIf(process.platform !== "darwin")("local mac deploy identity", () => {
  it("only accepts an existing app with the same namespace and bundle identifier", async () => {
    const app = await makeApp("local-smoke");
    await expect(assertMatchingMacApp(app, "local-smoke", "io.open-design.desktop")).resolves.toBeUndefined();
    await expect(assertMatchingMacApp(app, "other", "io.open-design.desktop")).rejects.toThrow("different namespace");
    await expect(assertMatchingMacApp(app, "local-smoke", "different.id")).rejects.toThrow("different namespace");
  });

  it("refuses symlinks and unverifiable app bundles", async () => {
    const app = await makeApp("local-smoke");
    const link = join(roots.at(-1)!, "link.app");
    await symlink(app, link);
    await expect(assertMatchingMacApp(link, "local-smoke", "io.open-design.desktop")).rejects.toThrow("not an app bundle");
    await rm(join(app, "Contents", "Info.plist"));
    await expect(assertMatchingMacApp(app, "local-smoke", "io.open-design.desktop")).rejects.toThrow("cannot verify");
  });

  it("rejects a non-portable build before invoking the packager", async () => {
    const root = await mkdtemp(join(tmpdir(), "od-deploy-test-"));
    roots.push(root);
    await expect(deployLocalMacApp({ portable: false, signed: true, to: "app" } as ToolPackConfig, root))
      .rejects.toThrow("portable, signed");
  });
});
