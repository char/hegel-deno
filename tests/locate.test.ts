import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  libhegelAssetName,
  nativeDir,
  resolveLibrary,
  locateLibhegel,
  LIBRARY_PATH_ENV,
} from "../src/locate.js";
import { LIBHEGEL_CHECKSUMS, LIBHEGEL_VERSION } from "../src/checksums.js";

const HOST_PLATFORM = process.platform;
const HOST_ARCH = process.arch;
const REAL_ASSET = libhegelAssetName(HOST_PLATFORM, HOST_ARCH);

describe("libhegelAssetName", () => {
  it("maps each supported os/arch to a bundled asset", () => {
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

describe("nativeDir", () => {
  it("points at the package's native/ directory", () => {
    expect(path.basename(nativeDir())).toBe("native");
  });
});

describe("resolveLibrary", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hegel-native-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the explicit override without consulting the bundle", () => {
    expect(
      resolveLibrary({
        env: { [LIBRARY_PATH_ENV]: "/opt/libhegel.so" },
        platform: HOST_PLATFORM,
        arch: HOST_ARCH,
        nativeDir: tmpDir,
      }),
    ).toBe("/opt/libhegel.so");
  });

  it("returns the bundled artifact for the host platform", () => {
    const dest = path.join(tmpDir, REAL_ASSET);
    fs.writeFileSync(dest, "fake lib");
    expect(
      resolveLibrary({ env: {}, platform: HOST_PLATFORM, arch: HOST_ARCH, nativeDir: tmpDir }),
    ).toBe(dest);
  });

  it("throws when the bundled artifact is missing", () => {
    expect(() =>
      resolveLibrary({ env: {}, platform: HOST_PLATFORM, arch: HOST_ARCH, nativeDir: tmpDir }),
    ).toThrow(/Bundled libhegel not found/);
  });

  it("propagates the unsupported-platform error before checking the bundle", () => {
    expect(() =>
      resolveLibrary({
        env: {},
        platform: "freebsd" as NodeJS.Platform,
        arch: HOST_ARCH,
        nativeDir: tmpDir,
      }),
    ).toThrow(/Unsupported platform/);
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

  it("resolves the bundled artifact when no override is set", () => {
    delete process.env[LIBRARY_PATH_ENV];
    // native/ is populated before the test run (just fetch-libhegel), so the
    // host artifact resolves to a real file under the package's native dir.
    const resolved = locateLibhegel();
    expect(resolved).toBe(path.join(nativeDir(), REAL_ASSET));
    expect(fs.existsSync(resolved)).toBe(true);
  });
});

describe("checksums module", () => {
  it("pins a version and provides a checksum per published asset", () => {
    expect(LIBHEGEL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Object.keys(LIBHEGEL_CHECKSUMS).length).toBe(5);
  });
});
