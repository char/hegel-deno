import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import {
  libhegelAssetName,
  cacheDir,
  downloadUrl,
  normalizeHome,
  ensureLibrarySync,
  locateLibhegel,
  SYNC_DOWNLOADER_PROGRAM,
  type SpawnSyncFn,
  LIBRARY_PATH_ENV,
  NO_DOWNLOAD_ENV,
  DOWNLOAD_BASE_URL_ENV,
} from "../src/locate.js";
import { LIBHEGEL_CHECKSUMS, LIBHEGEL_VERSION } from "../src/checksums.js";

// Use the host's published asset so the checksum-verification tests work on
// any CI architecture (the released artifact lives in .hegel/, fetched by the
// `just fetch-libhegel` step before the test run).
const REAL_ASSET = libhegelAssetName(process.platform, process.arch);
const HOST_PLATFORM = process.platform;
const HOST_ARCH = process.arch;
const realLibBytes = (): Buffer => fs.readFileSync(path.join(process.cwd(), ".hegel", REAL_ASSET));

function fakeSpawnResult(over: Partial<SpawnSyncReturns<string>>): SpawnSyncReturns<string> {
  return {
    pid: 1,
    output: [],
    stdout: "",
    stderr: "",
    status: 0,
    signal: null,
    ...over,
  } as SpawnSyncReturns<string>;
}

describe("libhegelAssetName", () => {
  it("maps each supported os/arch to a published asset", () => {
    expect(libhegelAssetName("linux", "x64")).toBe("libhegel-linux-amd64.so");
    expect(libhegelAssetName("linux", "arm64")).toBe("libhegel-linux-arm64.so");
    expect(libhegelAssetName("darwin", "arm64")).toBe("libhegel-darwin-arm64.dylib");
    expect(libhegelAssetName("win32", "x64")).toBe("libhegel-windows-amd64.dll");
    expect(libhegelAssetName("win32", "arm64")).toBe("libhegel-windows-arm64.dll");
  });

  it("throws for an unsupported platform", () => {
    expect(() => libhegelAssetName("freebsd" as NodeJS.Platform, "x64")).toThrow(
      /Unsupported platform/,
    );
  });

  it("throws for an unsupported architecture", () => {
    expect(() => libhegelAssetName("linux", "ia32")).toThrow(/Unsupported architecture/);
  });
});

describe("cacheDir", () => {
  it("prefers XDG_CACHE_HOME", () => {
    expect(cacheDir("/xdg", "/home/u", "0.1.0")).toBe(
      path.join("/xdg", "hegel-typescript", "libhegel", "0.1.0"),
    );
  });

  it("falls back to ~/.cache when XDG is null or empty", () => {
    expect(cacheDir(null, "/home/u", "0.1.0")).toBe(
      path.join("/home/u", ".cache", "hegel-typescript", "libhegel", "0.1.0"),
    );
    expect(cacheDir("", "/home/u", "0.1.0")).toBe(
      path.join("/home/u", ".cache", "hegel-typescript", "libhegel", "0.1.0"),
    );
  });

  it("throws when neither XDG nor home is available", () => {
    expect(() => cacheDir(null, null, "0.1.0")).toThrow(/Could not determine cache directory/);
    expect(() => cacheDir(null, "", "0.1.0")).toThrow(/Could not determine cache directory/);
  });
});

describe("downloadUrl", () => {
  it("joins base, version and asset, trimming trailing slashes", () => {
    expect(downloadUrl("https://example.com/dl", "1.2.3", "lib.so")).toBe(
      "https://example.com/dl/v1.2.3/lib.so",
    );
    expect(downloadUrl("https://example.com/dl///", "1.2.3", "lib.so")).toBe(
      "https://example.com/dl/v1.2.3/lib.so",
    );
  });
});

describe("normalizeHome", () => {
  it("maps empty string to null", () => {
    expect(normalizeHome("")).toBeNull();
    expect(normalizeHome("/home/u")).toBe("/home/u");
  });
});

describe("ensureLibrarySync (injected spawn)", () => {
  let tmpDir: string;
  let xdg: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hegel-ensure-"));
    xdg = path.join(tmpDir, "xdg");
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const base = {
    platform: HOST_PLATFORM,
    arch: HOST_ARCH,
    homeDir: "/home/u",
    execPath: "/usr/bin/node",
    version: "0.20.1",
  };

  it("returns the explicit override without downloading", () => {
    const spawn: SpawnSyncFn = () => {
      throw new Error("should not spawn");
    };
    expect(
      ensureLibrarySync({ ...base, env: { [LIBRARY_PATH_ENV]: "/opt/libhegel.so" }, spawn }),
    ).toBe("/opt/libhegel.so");
  });

  it("returns a cached file without downloading", () => {
    const dir = cacheDir(xdg, base.homeDir, base.version);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, REAL_ASSET);
    fs.writeFileSync(dest, "cached");
    const spawn: SpawnSyncFn = () => {
      throw new Error("should not spawn");
    };
    expect(ensureLibrarySync({ ...base, env: { XDG_CACHE_HOME: xdg }, spawn })).toBe(dest);
  });

  it("throws when not cached and downloads are disabled", () => {
    const spawn: SpawnSyncFn = () => fakeSpawnResult({});
    expect(() =>
      ensureLibrarySync({
        ...base,
        env: { XDG_CACHE_HOME: xdg, [NO_DOWNLOAD_ENV]: "1" },
        spawn,
      }),
    ).toThrow(new RegExp(NO_DOWNLOAD_ENV));
  });

  it("throws for an asset with no baked-in checksum (unsupported platform)", () => {
    const spawn: SpawnSyncFn = () => fakeSpawnResult({});
    expect(() =>
      ensureLibrarySync({
        ...base,
        arch: "x64",
        platform: "darwin", // libhegel-darwin-amd64.dylib is not published
        env: { XDG_CACHE_HOME: xdg },
        spawn,
      }),
    ).toThrow(/unsupported platform/);
  });

  it("downloads, verifies the checksum and installs the library (success)", () => {
    const bytes = realLibBytes();
    const spawn: SpawnSyncFn = (_cmd, _args, options) => {
      fs.writeFileSync(options.env.HEGEL_DL_DEST as string, bytes);
      return fakeSpawnResult({ status: 0 });
    };
    const got = ensureLibrarySync({ ...base, env: { XDG_CACHE_HOME: xdg }, spawn });
    expect(got).toBe(path.join(cacheDir(xdg, base.homeDir, base.version), REAL_ASSET));
    expect(fs.existsSync(got)).toBe(true);
  });

  it("rejects and cleans up on a checksum mismatch", () => {
    const spawn: SpawnSyncFn = (_cmd, _args, options) => {
      fs.writeFileSync(options.env.HEGEL_DL_DEST as string, "wrong bytes");
      return fakeSpawnResult({ status: 0 });
    };
    expect(() => ensureLibrarySync({ ...base, env: { XDG_CACHE_HOME: xdg }, spawn })).toThrow(
      /Checksum mismatch/,
    );
    const dir = cacheDir(xdg, base.homeDir, base.version);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("wraps a spawn failure (stderr)", () => {
    const spawn: SpawnSyncFn = () => fakeSpawnResult({ status: 1, stderr: "HTTP 404\n" });
    expect(() => ensureLibrarySync({ ...base, env: { XDG_CACHE_HOME: xdg }, spawn })).toThrow(
      /Failed to download libhegel.*HTTP 404/s,
    );
  });

  it("wraps a spawn failure (spawn error object)", () => {
    const spawn: SpawnSyncFn = () =>
      fakeSpawnResult({ status: null, error: new Error("spawn ENOENT") });
    expect(() => ensureLibrarySync({ ...base, env: { XDG_CACHE_HOME: xdg }, spawn })).toThrow(
      /spawn ENOENT/,
    );
  });

  it("wraps a spawn failure (no stderr, no error)", () => {
    const spawn: SpawnSyncFn = () => fakeSpawnResult({ status: 7, stderr: "" });
    expect(() => ensureLibrarySync({ ...base, env: { XDG_CACHE_HOME: xdg }, spawn })).toThrow(
      /exit code 7/,
    );
  });

  it("uses the default version, ~/.cache, and real spawnSync when none are injected", () => {
    // No version (defaults to LIBHEGEL_VERSION), no XDG_CACHE_HOME (falls back
    // to homeDir/.cache), and no injected spawn (uses the real spawnSync). The
    // download targets a closed port so the child fails fast (no deadlock).
    expect(() =>
      ensureLibrarySync({
        env: { [DOWNLOAD_BASE_URL_ENV]: "http://127.0.0.1:1" },
        platform: HOST_PLATFORM,
        arch: HOST_ARCH,
        homeDir: tmpDir,
        execPath: process.execPath,
      }),
    ).toThrow(/Failed to download libhegel/);
  });
});

describe("SYNC_DOWNLOADER_PROGRAM (real child node process)", () => {
  // Validates the inline downloader end-to-end. It must run via *async* spawn:
  // ensureLibrarySync uses spawnSync, which would block this process's event
  // loop and deadlock against an in-process HTTP server.
  let tmpDir: string;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hegel-real-dl-"));
    const bytes = realLibBytes();
    server = http.createServer((req, res) => {
      if (req.url?.endsWith("/redirect")) {
        res.statusCode = 302;
        res.setHeader("location", "/final");
        res.end();
        return;
      }
      res.statusCode = 200;
      res.end(bytes);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runDownloader(url: string, dest: string): Promise<number> {
    return new Promise<number>((resolve) => {
      const child = spawn(process.execPath, ["-e", SYNC_DOWNLOADER_PROGRAM], {
        env: { ...process.env, HEGEL_DL_URL: url, HEGEL_DL_DEST: dest },
        stdio: "ignore",
      });
      child.on("exit", (code) => resolve(code ?? -1));
    });
  }

  it("downloads, following redirects, producing the correct bytes", async () => {
    const dest = path.join(tmpDir, "out.so");
    const code = await runDownloader(`${baseUrl}/redirect`, dest);
    expect(code).toBe(0);
    const sum = createHash("sha256").update(fs.readFileSync(dest)).digest("hex");
    expect(sum).toBe(LIBHEGEL_CHECKSUMS[REAL_ASSET]);
  });

  it("exits non-zero on an HTTP error", async () => {
    const code = await runDownloader("http://127.0.0.1:1/x", path.join(tmpDir, "out.so"));
    expect(code).not.toBe(0);
  });
});

describe("locateLibhegel", () => {
  const saved = process.env[LIBRARY_PATH_ENV];
  afterEach(() => {
    if (saved === undefined) delete process.env[LIBRARY_PATH_ENV];
    else process.env[LIBRARY_PATH_ENV] = saved;
  });

  it("resolves via the process environment override", () => {
    process.env[LIBRARY_PATH_ENV] = "/tmp/some-libhegel.so";
    expect(locateLibhegel()).toBe("/tmp/some-libhegel.so");
  });
});

describe("checksums module", () => {
  it("pins a version and provides a checksum per published asset", () => {
    expect(LIBHEGEL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Object.keys(LIBHEGEL_CHECKSUMS).length).toBe(5);
  });
});
