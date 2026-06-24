/**
 * Locates the native `libhegel` shared library for the host platform.
 *
 * The per-platform shared libraries are bundled into the published npm package
 * (under `native/`, fetched at pack time by `scripts/fetch-libhegel.mjs`), so
 * there is nothing to download or cache at runtime. Resolution is:
 *
 * 1. `$HEGEL_LIBHEGEL_PATH`, if set — used directly (a local build / override).
 * 2. The bundled artifact for the host platform under the package's `native/`
 *    directory.
 *
 * Resolution is synchronous: the library must be available before the
 * (synchronous) `hegel.test` run loop starts.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Env var pinning libhegel to an explicit path (overrides the bundled copy). */
export const LIBRARY_PATH_ENV = "HEGEL_LIBHEGEL_PATH";

/**
 * Returns the bundled asset filename for the given platform and architecture,
 * e.g. `libhegel-linux-arm64.so`. Throws for an unsupported OS or CPU
 * architecture.
 */
export function libhegelAssetName(platform: NodeJS.Platform, arch: string): string {
  let osName: string;
  let ext: string;
  switch (platform) {
    case "linux":
      osName = "linux";
      ext = "so";
      break;
    case "darwin":
      osName = "darwin";
      ext = "dylib";
      break;
    case "win32":
      osName = "windows";
      ext = "dll";
      break;
    default:
      throw new Error(`Unsupported platform '${platform}' for libhegel`);
  }

  let archName: string;
  switch (arch) {
    case "x64":
      archName = "amd64";
      break;
    case "arm64":
      archName = "arm64";
      break;
    default:
      throw new Error(`Unsupported architecture '${arch}' for libhegel`);
  }

  return `libhegel-${osName}-${archName}.${ext}`;
}

/** Directory holding the bundled shared libraries, relative to this module. */
export function nativeDir(): string {
  // At runtime this module is `dist/locate.js`; under tests it is `src/locate.ts`.
  // Either way the bundled `native/` directory sits one level up.
  return path.join(import.meta.dirname, "..", "native");
}

/**
 * Resolves a filesystem path to the native libhegel library. The environment,
 * platform, architecture and native directory are passed in so the resolution
 * logic is fully unit-testable.
 */
export function resolveLibrary(opts: {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  arch: string;
  nativeDir: string;
}): string {
  const override = opts.env[LIBRARY_PATH_ENV];
  if (override !== undefined && override !== "") {
    return override;
  }

  const asset = libhegelAssetName(opts.platform, opts.arch);
  const bundled = path.join(opts.nativeDir, asset);
  if (!fs.existsSync(bundled)) {
    throw new Error(
      `Bundled libhegel not found at ${bundled}. This usually means the package ` +
        `was built without its native libraries; run \`just fetch-libhegel\` (or set ` +
        `${LIBRARY_PATH_ENV} to a local libhegel).`,
    );
  }
  return bundled;
}

/**
 * Resolves the libhegel path for the current process environment.
 */
export function locateLibhegel(): string {
  return resolveLibrary({
    env: process.env,
    platform: process.platform,
    arch: process.arch,
    nativeDir: nativeDir(),
  });
}
