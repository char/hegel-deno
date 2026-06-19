/**
 * Resolve the libhegel path for tests. Honors `HEGEL_LIBHEGEL_PATH`; otherwise
 * falls back to the per-platform artifact cached in the repo's `.hegel/`
 * directory (downloaded during development / by CI before the test run).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { libhegelAssetName } from "../src/locate.js";

export function testLibPath(): string {
  const override = process.env.HEGEL_LIBHEGEL_PATH;
  if (override) {
    return override;
  }
  const asset = libhegelAssetName(process.platform, process.arch);
  const candidate = path.join(process.cwd(), ".hegel", asset);
  if (!fs.existsSync(candidate)) {
    throw new Error(
      `libhegel not found at ${candidate}. Set HEGEL_LIBHEGEL_PATH or download the ` +
        `v0.20.1 artifact into .hegel/.`,
    );
  }
  return candidate;
}
