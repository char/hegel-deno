RELEASE_TYPE: minor

Hegel now drives [libhegel](https://github.com/hegeldev/hegel-rust) — the native
Rust engine — directly via FFI, instead of spawning the `hegel-core` Python
server and talking to it over a socket protocol. On first use it downloads the
matching `libhegel` shared library for your platform (SHA-256 verified) and
caches it; set `HEGEL_LIBHEGEL_PATH` to use a local build, or
`HEGEL_LIBHEGEL_NO_DOWNLOAD=1` to opt out of the download.

The public API (`test`, `testAsync`, `Settings`, and the generators) is
unchanged. Two user-visible requirement changes:

- Hegel no longer needs Python or `uv`.
- Hegel now requires Node 20.11+ (the native FFI layer uses a loader that
  depends on a recent Node).
