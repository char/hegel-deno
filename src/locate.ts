/**
 * Locates the native `libhegel` shared library for the Deno host.
 *
 * Resolution is `$HEGEL_LIBHEGEL_PATH`, followed by the bundled artifact under
 * `native/`.
 *
 * @packageDocumentation
 */

export const LIBRARY_PATH_ENV = "HEGEL_LIBHEGEL_PATH";

export function libhegelAssetName(platform: string, arch: string): string {
  let osName: string;
  let extension: string;
  switch (platform) {
    case "linux":
      osName = "linux";
      extension = "so";
      break;
    case "darwin":
      osName = "darwin";
      extension = "dylib";
      break;
    case "windows":
      osName = "windows";
      extension = "dll";
      break;
    default:
      throw new Error(`Unsupported platform '${platform}' for libhegel`);
  }

  let architecture: string;
  switch (arch) {
    case "x86_64":
      architecture = "amd64";
      break;
    case "aarch64":
      architecture = "arm64";
      break;
    default:
      throw new Error(`Unsupported architecture '${arch}' for libhegel`);
  }

  return `libhegel-${osName}-${architecture}.${extension}`;
}

export function nativeDir(): string {
  return `${import.meta.dirname}/../native`;
}

export function resolveLibrary(options: {
  env: Record<string, string | undefined>;
  platform: string;
  arch: string;
  nativeDir: string;
}): string {
  const override = options.env[LIBRARY_PATH_ENV];
  if (override) return override;

  const bundled = `${options.nativeDir}/${libhegelAssetName(options.platform, options.arch)}`;
  try {
    Deno.statSync(bundled);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    throw new Error(
      `Bundled libhegel not found at ${bundled}. Run \`node scripts/fetch-libhegel.mjs\` ` +
        `(or set ${LIBRARY_PATH_ENV} to a local libhegel).`,
    );
  }
  return bundled;
}

export function locateLibhegel(): string {
  return resolveLibrary({
    env: { [LIBRARY_PATH_ENV]: Deno.env.get(LIBRARY_PATH_ENV) },
    platform: Deno.build.os,
    arch: Deno.build.arch,
    nativeDir: nativeDir(),
  });
}
