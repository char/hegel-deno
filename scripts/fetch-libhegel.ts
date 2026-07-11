import { LIBHEGEL_CHECKSUMS, LIBHEGEL_VERSION } from "../src/checksums.ts";

const nativeDir = new URL("../native/", import.meta.url);
const baseUrl = `https://github.com/hegeldev/hegel-rust/releases/download/v${LIBHEGEL_VERSION}`;

function hostAsset(): string {
  const platform = (
    {
      linux: ["linux", "so"],
      darwin: ["darwin", "dylib"],
      windows: ["windows", "dll"],
    } as Partial<Record<string, [os: string, ext: string]>>
  )[Deno.build.os];
  const arch = (
    {
      x86_64: "amd64",
      aarch64: "arm64",
    } as Partial<Record<string, string>>
  )[Deno.build.arch];

  if (!platform || !arch) {
    throw new Error(`unsupported host ${Deno.build.os}/${Deno.build.arch}`);
  }
  return `libhegel-${platform[0]}-${arch}.${platform[1]}`;
}

async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data.slice().buffer);
  const toHex = (byte: number) => byte.toString(16).padStart(2, "0");
  return [...new Uint8Array(digest)].map(toHex).join("");
}

async function fetchAsset(asset: string): Promise<string> {
  const expected = LIBHEGEL_CHECKSUMS[asset];
  if (!expected) {
    throw new Error(`no published libhegel artifact for '${asset}' at v${LIBHEGEL_VERSION}`);
  }

  const destination = new URL(asset, nativeDir);
  try {
    if ((await sha256(await Deno.readFile(destination))) === expected) {
      console.error(`libhegel: ${asset} already present`);
      return await Deno.realPath(destination);
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }

  console.error(`libhegel: downloading ${asset}`);
  const response = await fetch(`${baseUrl}/${asset}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${response.url}`);
  }

  const data = new Uint8Array(await response.arrayBuffer());
  const actual = await sha256(data);
  if (actual !== expected) {
    throw new Error(`checksum mismatch for ${asset}: got ${actual}, want ${expected}`);
  }

  await Deno.writeFile(destination, data);
  if (Deno.build.os !== "windows") await Deno.chmod(destination, 0o755);
  return await Deno.realPath(destination);
}

await Deno.mkdir(nativeDir, { recursive: true });
if (Deno.args.includes("--all")) {
  for (const asset of Object.keys(LIBHEGEL_CHECKSUMS).sort()) {
    await fetchAsset(asset);
  }
} else {
  console.log(await fetchAsset(hostAsset()));
}
