/**
 * Resolve the libhegel path for tests. Honors `HEGEL_LIBHEGEL_PATH`; otherwise
 * falls back to the per-platform artifact bundled in the repo's `native/`
 * directory (populated by `deno task fetch-libhegel` / `scripts/fetch-libhegel.ts`
 * before the test run).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { libhegelAssetName } from "../src/locate.ts";

export function testLibPath(): string {
  const override = process.env.HEGEL_LIBHEGEL_PATH;
  if (override) {
    return override;
  }
  const asset = libhegelAssetName(Deno.build.os, Deno.build.arch);
  const candidate = path.join(process.cwd(), "native", asset);
  if (!fs.existsSync(candidate)) {
    throw new Error(
      `libhegel not found at ${candidate}. Set HEGEL_LIBHEGEL_PATH or run ` +
        `\`deno task fetch-libhegel\` to download the v0.23.0 artifact into native/.`,
    );
  }
  return candidate;
}
