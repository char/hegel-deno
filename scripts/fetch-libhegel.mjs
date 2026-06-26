// Downloads the prebuilt libhegel shared libraries into `native/` so they can
// be bundled into the published npm tarball (see the `prepack` script and the
// `files` entry in package.json). The runtime no longer downloads anything: it
// loads the bundled artifact for the host platform directly (see src/locate.ts).
//
// Each artifact is verified against the SHA-256 digest baked into
// src/checksums.ts before it is accepted — fetching a checksum file from the
// same release would provide no integrity guarantee, so the digests live in the
// repository (run `just update-checksums` to refresh them).
//
// Usage:
//   node scripts/fetch-libhegel.mjs            # the host platform's artifact
//   node scripts/fetch-libhegel.mjs --all      # every supported platform
//
// Without --all it prints the absolute path of the host artifact to stdout (so
// `just fetch-libhegel` can capture it); progress is logged to stderr.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import * as fs from "node:fs";
import { get as httpsGet } from "node:https";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECKSUMS_TS = path.join(ROOT, "src", "checksums.ts");
const NATIVE_DIR = path.join(ROOT, "native");
const BASE_URL = "https://github.com/hegeldev/hegel-rust/releases/download";

/** Parse the pinned version and per-asset digests out of src/checksums.ts. */
function readChecksums() {
  const text = fs.readFileSync(CHECKSUMS_TS, "utf8");
  const versionMatch = /export const LIBHEGEL_VERSION = "([^"]+)";/.exec(text);
  if (!versionMatch) {
    throw new Error("could not find LIBHEGEL_VERSION in src/checksums.ts");
  }
  const checksums = {};
  const re = /"(libhegel-[a-z0-9-]+\.(?:so|dylib|dll))":\s*"([0-9a-f]{64})"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    checksums[m[1]] = m[2];
  }
  if (Object.keys(checksums).length === 0) {
    throw new Error("no libhegel checksums found in src/checksums.ts");
  }
  return { version: versionMatch[1], checksums };
}

/** The published asset filename for the host platform/arch. */
function hostAsset() {
  const ext = { linux: "so", darwin: "dylib", win32: "dll" }[process.platform];
  const arch = { x64: "amd64", arm64: "arm64" }[process.arch];
  const os = process.platform === "win32" ? "windows" : process.platform;
  if (ext === undefined || arch === undefined) {
    throw new Error(`unsupported host ${process.platform}/${process.arch} for libhegel`);
  }
  return `libhegel-${os}-${arch}.${ext}`;
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Stream a URL to a file, following redirects. */
function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    httpsGet(url, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) {
          reject(new Error("too many redirects"));
          return;
        }
        download(new URL(res.headers.location, url).toString(), dest, redirects - 1).then(
          resolve,
          reject,
        );
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${status} for ${url}`));
        return;
      }
      const out = createWriteStream(dest);
      out.on("error", reject);
      out.on("finish", () => resolve());
      res.pipe(out);
    }).on("error", reject);
  });
}

/** Fetch a single asset into native/, verifying it against its baked-in digest. */
async function fetchAsset(asset, version, wantSum) {
  const dest = path.join(NATIVE_DIR, asset);
  if (fs.existsSync(dest) && sha256(dest) === wantSum) {
    process.stderr.write(`libhegel: ${asset} already present\n`);
    return dest;
  }
  const url = `${BASE_URL}/v${version}/${asset}`;
  const tmp = `${dest}.${process.pid}.partial`;
  process.stderr.write(`libhegel: downloading ${asset}\n`);
  await download(url, tmp);
  const gotSum = sha256(tmp);
  if (gotSum !== wantSum) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`checksum mismatch for ${asset}: got ${gotSum}, want ${wantSum}`);
  }
  fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, dest);
  return dest;
}

async function main() {
  const all = process.argv.includes("--all");
  const { version, checksums } = readChecksums();
  fs.mkdirSync(NATIVE_DIR, { recursive: true });

  if (all) {
    for (const asset of Object.keys(checksums).sort()) {
      await fetchAsset(asset, version, checksums[asset]);
    }
    return;
  }

  const asset = hostAsset();
  const wantSum = checksums[asset];
  if (wantSum === undefined) {
    throw new Error(`no published libhegel artifact for '${asset}' at v${version}`);
  }
  const dest = await fetchAsset(asset, version, wantSum);
  process.stdout.write(`${dest}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err.message ?? err}\n`);
  process.exit(1);
});
