RELEASE_TYPE: minor

hegel-typescript now uses [libhegel](https://github.com/hegeldev/hegel-rust) — the native
Rust engine — directly via FFI, instead of spawning the `hegel-core` Python
server and talking to it over a socket protocol.

The public API is unchanged. Two user-visible requirement changes:

- Hegel no longer needs Python or `uv`.
- Hegel now requires Node 20.11+ (the native FFI layer uses a loader that
  depends on a recent Node).
