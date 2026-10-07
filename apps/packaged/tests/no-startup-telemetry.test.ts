import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

it("keeps packaged startup failures local instead of reporting them to a telemetry service", () => {
  const entry = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  expect(entry).toContain('packagedLogger?.error("packaged runtime failed", { error });');
  expect(entry).not.toContain("reportStartupFailure(");
  expect(entry).not.toContain('from "./startup-telemetry.js"');
});
