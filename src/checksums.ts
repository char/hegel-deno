/**
 * SHA-256 checksums for the published libhegel release artifacts.
 *
 * These are the checksums attached to the hegel-rust GitHub release at
 * {@link LIBHEGEL_VERSION} (each artifact is published alongside a
 * `<asset>.sha256` file). The auto-downloader in `locate.ts` verifies a
 * downloaded artifact against the entry for the host platform's asset before
 * loading it.
 *
 * Regenerate after bumping {@link LIBHEGEL_VERSION} by fetching the `.sha256`
 * files from the matching `v<version>` release.
 *
 * @packageDocumentation
 */

/** The pinned libhegel version this client targets. */
export const LIBHEGEL_VERSION = "0.20.1";

/** Map from published asset filename to its SHA-256 hex digest. */
export const LIBHEGEL_CHECKSUMS: Readonly<Record<string, string>> = {
  "libhegel-darwin-arm64.dylib": "d04d34428b3e5b95f1576a112fb14dd499b04051a5723a043d6a234d2ab9d4c0",
  "libhegel-linux-amd64.so": "e8f7eb1e9c3900cf51a70ccd988e04c230614a533973eb4e0ea869f0ac1a3d3c",
  "libhegel-linux-arm64.so": "21305a1d319f45bccc8dde394ba716777c645329b0df850fe796817026e37cc1",
  "libhegel-windows-amd64.dll": "cf0f150a645fd5cdfb1be728a41e8046a8e855109ce29471b3ffef4708110a84",
  "libhegel-windows-arm64.dll": "444666ab6e14f27b3a3f7493d1bf4a72d8bd501f069bce664447188cba837ec6",
};
