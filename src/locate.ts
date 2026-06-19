/**
 * Locates the native `libhegel` shared library for the host platform.
 *
 * Resolution order (first hit wins):
 *
 * 1. `$HEGEL_LIBHEGEL_PATH`, if set — used directly with no download fallback
 *    (an explicit override means the user wants that exact file).
 * 2. A previously-downloaded copy in the per-version cache directory
 *    (`$XDG_CACHE_HOME/hegel-typescript/libhegel/<version>/` or
 *    `~/.cache/hegel-typescript/libhegel/<version>/`).
 * 3. The matching artifact downloaded from the hegel-rust GitHub release,
 *    verified against the baked-in SHA-256 ({@link LIBHEGEL_CHECKSUMS}). The
 *    download is skipped when `$HEGEL_LIBHEGEL_NO_DOWNLOAD` is set.
 *
 * Resolution is synchronous: the library must be available before the
 * (synchronous) `hegel.test` run loop starts. Node has no synchronous HTTP, so
 * the one-time first-run download is performed by a short-lived child `node`
 * process (mirroring how the previous `uv`-based client installed its server on
 * first use). The checksum is verified in this process afterwards.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import { LIBHEGEL_CHECKSUMS, LIBHEGEL_VERSION } from "./checksums.js";

/** Env var pinning libhegel to an explicit path (no download fallback). */
export const LIBRARY_PATH_ENV = "HEGEL_LIBHEGEL_PATH";
/** Env var that, when set to a non-empty value, disables the auto-downloader. */
export const NO_DOWNLOAD_ENV = "HEGEL_LIBHEGEL_NO_DOWNLOAD";
/** Env var overriding the release download base URL (used by tests). */
export const DOWNLOAD_BASE_URL_ENV = "HEGEL_DOWNLOAD_BASE_URL";

const DEFAULT_BASE_URL = "https://github.com/hegeldev/hegel-rust/releases/download";

/**
 * Self-contained downloader run in a child `node` process. Reads the source
 * URL and destination path from the environment, streams the body to disk
 * following redirects, and exits non-zero with a message on stderr on failure.
 * Checksum verification happens in the parent.
 */
export const SYNC_DOWNLOADER_PROGRAM = `
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
function get(url, redirects, cb) {
  const mod = url.startsWith('https:') ? https : http;
  const req = mod.get(url, (res) => {
    const status = res.statusCode || 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      if (redirects <= 0) { cb(new Error('too many redirects')); return; }
      get(new URL(res.headers.location, url).toString(), redirects - 1, cb);
      return;
    }
    if (status !== 200) { res.resume(); cb(new Error('HTTP ' + status)); return; }
    const out = fs.createWriteStream(process.env.HEGEL_DL_DEST);
    out.on('error', cb);
    out.on('finish', () => cb(null));
    res.pipe(out);
  });
  req.on('error', cb);
}
get(process.env.HEGEL_DL_URL, 5, (err) => {
  if (err) { console.error(String((err && err.message) || err)); process.exit(1); }
  process.exit(0);
});
`;

/**
 * Returns the published asset filename for the given platform and
 * architecture, e.g. `libhegel-linux-arm64.so`. Throws for an unsupported OS
 * or CPU architecture.
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

/**
 * Returns the per-version cache directory for downloaded libraries. `null` for
 * both inputs means neither `$XDG_CACHE_HOME` nor a home directory is known.
 */
export function cacheDir(
  xdgCacheHome: string | null,
  homeDir: string | null,
  version: string,
): string {
  let root: string;
  if (xdgCacheHome !== null && xdgCacheHome !== "") {
    root = xdgCacheHome;
  } else if (homeDir !== null && homeDir !== "") {
    root = path.join(homeDir, ".cache");
  } else {
    throw new Error("Could not determine cache directory for libhegel");
  }
  return path.join(root, "hegel-typescript", "libhegel", version);
}

/** Returns the release download URL for an asset. */
export function downloadUrl(baseUrl: string, version: string, asset: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/v${version}/${asset}`;
}

/** Normalizes an OS home directory string, mapping `""` to `null`. */
export function normalizeHome(home: string): string | null {
  return home === "" ? null : home;
}

/** A subset of {@link spawnSync} sufficient for the downloader, for injection. */
export type SpawnSyncFn = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; encoding: "utf8" },
) => SpawnSyncReturns<string>;

/** Builds the failure detail string from a {@link spawnSync} result. */
function spawnFailureDetail(res: SpawnSyncReturns<string>): string {
  if (res.error) {
    return res.error.message;
  }
  return res.stderr || `exit code ${res.status}`;
}

/**
 * Resolves a filesystem path to the native libhegel library, downloading and
 * caching it (via a child process) if necessary. The environment, platform,
 * home directory, node executable and spawn function are passed in so the
 * resolution logic is fully unit-testable.
 */
export function ensureLibrarySync(opts: {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  arch: string;
  homeDir: string | null;
  execPath: string;
  version?: string;
  spawn?: SpawnSyncFn;
}): string {
  const override = opts.env[LIBRARY_PATH_ENV];
  if (override !== undefined && override !== "") {
    return override;
  }

  const version = opts.version ?? LIBHEGEL_VERSION;
  const asset = libhegelAssetName(opts.platform, opts.arch);
  const dir = cacheDir(opts.env.XDG_CACHE_HOME ?? null, opts.homeDir, version);
  const dest = path.join(dir, asset);
  if (fs.existsSync(dest)) {
    return dest;
  }

  if ((opts.env[NO_DOWNLOAD_ENV] ?? "") !== "") {
    throw new Error(
      `libhegel is not cached and auto-download is disabled by ${NO_DOWNLOAD_ENV}. ` +
        `Set ${LIBRARY_PATH_ENV} to a local libhegel, or unset ${NO_DOWNLOAD_ENV}.`,
    );
  }
  const wantSum = LIBHEGEL_CHECKSUMS[asset];
  if (wantSum === undefined) {
    throw new Error(
      `No published libhegel artifact for '${asset}' at version ${version} ` +
        `(unsupported platform). Set ${LIBRARY_PATH_ENV} to a local libhegel.`,
    );
  }

  fs.mkdirSync(dir, { recursive: true });
  const baseUrl = opts.env[DOWNLOAD_BASE_URL_ENV] || DEFAULT_BASE_URL;
  const url = downloadUrl(baseUrl, version, asset);
  const tmp = `${dest}.${process.pid}.partial`;
  const spawn: SpawnSyncFn = opts.spawn ?? spawnSync;

  const res = spawn(opts.execPath, ["-e", SYNC_DOWNLOADER_PROGRAM], {
    env: { ...opts.env, HEGEL_DL_URL: url, HEGEL_DL_DEST: tmp },
    encoding: "utf8",
  });
  if (res.status !== 0) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`Failed to download libhegel from ${url}: ${spawnFailureDetail(res)}`);
  }

  const gotSum = createHash("sha256").update(fs.readFileSync(tmp)).digest("hex");
  if (gotSum !== wantSum) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`Checksum mismatch for ${url}: got ${gotSum}, want ${wantSum}`);
  }
  fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, dest);
  return dest;
}

/**
 * Resolves the libhegel path for the current process environment.
 */
export function locateLibhegel(): string {
  return ensureLibrarySync({
    env: process.env,
    platform: process.platform,
    arch: process.arch,
    homeDir: normalizeHome(os.homedir()),
    execPath: process.execPath,
  });
}
