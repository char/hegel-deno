# Hegel for TypeScript

## Build Commands

```bash
npm install  # Install dependencies
just test    # Run tests with coverage (fails if coverage < 100%)
just format  # Auto-format code
just lint    # Check formatting + linting
just docs    # Build API documentation
just check   # Run lint + docs + test (full CI check)
```

The native `libhegel` shared library is auto-downloaded (per platform, SHA-256
verified) on first use and cached under `~/.cache/hegel-typescript/` (see
`src/locate.ts`). Set `HEGEL_LIBHEGEL_PATH` to point at a local build to skip
the download; `HEGEL_LIBHEGEL_NO_DOWNLOAD=1` opts out of the download fallback.
`just fetch-libhegel` downloads the host artifact into `.hegel/` for offline
test runs; `just build-libhegel` builds it from a sibling `../hegel-rust`.

## What This Is

A TypeScript implementation of the Hegel property-based testing library. Hegel is a
universal property-based testing protocol powered by Hypothesis on the backend.
This client drives **libhegel** — the native Rust engine (`hegel-rust/hegel-c`,
version 0.20.1) — directly through its C ABI via the `koffi` FFI library. There
is no subprocess and no wire protocol: the engine runs on a worker thread inside
libhegel, and the client calls C functions synchronously.

## Architecture

The library is structured in layers, each building on the previous:

1. **Library loading** (`src/locate.ts`, `src/checksums.ts`) — resolve / download
   / verify the native `libhegel` shared library for the host platform.
2. **FFI binding** (`src/libhegel.ts`) — `koffi` bindings to the libhegel C ABI,
   wrapped in a typed `Libhegel` class. `int`-returning fallible calls map to
   thrown errors (`StopTestError` for `HEGEL_E_STOP_TEST`, `AssumeError` for
   `HEGEL_E_ASSUME`, otherwise `LibhegelError`).
3. **Session** (`src/session.ts`) — a process-global, lazily-loaded `Libhegel`
   handle with a `major.minor` version compatibility check.
4. **Test Runner** (`src/runner.ts`) — drives the `run_start` → `next_test_case`
   → `mark_complete` loop, mapping `Settings` onto the C setters and surfacing a
   failed/errored run as a thrown error. `NativeDataSource` implements the
   `DataSource` interface against a libhegel test case.
5. **Generators** (`src/generators/`) — type-safe generator abstraction, span
   system, collection protocol. Transport-agnostic: they build CBOR schemas and
   draw through the `DataSource` interface.

### Key Pattern: Synchronous FFI

All libhegel calls are synchronous (blocking) — `hegel.test` is a synchronous
function. `hegel.testAsync` awaits the user's async body between the
(synchronous) draws. `hegel_next_test_case` blocks until the engine's worker
thread produces the next case.

### Key Pattern: CBOR value codec (`src/cbor.ts`)

libhegel returns generated strings (and the string-shaped format generators) as
a CBOR **tag 91** wrapping WTF-8 bytes (preserving lone surrogates). `src/cbor.ts`
registers the tag-91 cbor-x extension and is the single CBOR entry point;
integer schema bounds must be CBOR integers (encode them as `bigint`), since the
engine strictly rejects float-encoded integers.

### Key Pattern: Global Lazy Handle

The native library is loaded by a global session that initializes lazily on
first use and stays loaded for the process lifetime. Users never construct it —
`hegel.test()` / `hegel.testAsync()` are plain free functions. Per-run
`Context`/`Settings`/`Run` handles are created and freed (in `finally`) by the
runner; test cases from `next_test_case` are borrowed and freed by `run_free`.

## Testing Philosophy

- **100% code coverage** is mandatory. `just check` fails if any line is uncovered.
  Drive real error paths against the real library (malformed schema, caller
  misuse) and use injected fake `Bindings` for the few NULL-return / result-code
  branches the engine can't easily be driven into — do NOT use `# nocov`.
- **Use the real `libhegel` library** for integration tests. Never write a mock
  engine. The engine runs on its own worker thread inside libhegel.
- A note on in-test downloads: `spawnSync` blocks the event loop, so a download
  test must not point the child at an in-process HTTP server (deadlock). Test the
  inline downloader via async `spawn`, and the resolution logic via injected
  spawn results.

## Composing generators

For composite types, use `composite` (imperative — call `.draw()` on
generators inside a builder function) or `record` (declarative — pass a schema
mapping field names to generators). Both live in `src/generators/compose.ts`
and are re-exported from `@hegeldev/hegel/generators`. They support `.map()`,
`.filter()`, and `.flatMap()` like any other generator.

## Critical: StopTest / Assume Handling

`hegel_generate` (and the other per-test-case primitives) return result codes
that `Libhegel.check` maps to exceptions:

1. `HEGEL_E_STOP_TEST` → `StopTestError` (choice budget exhausted). Unwind the
   body and `mark_complete` with `OVERRUN`.
2. `HEGEL_E_ASSUME` → `AssumeError` (the engine rejected the draw, e.g. an email
   precondition failed). Unwind and `mark_complete` with `INVALID`.
3. Any other non-OK code → `LibhegelError` carrying `hegel_context_last_error`.

`mark_complete` is always called exactly once per test case (no `test_aborted`
suppression — that was a wire-protocol concern).

## libhegel C ABI

The native engine is driven through the C functions declared in
`hegel-rust/hegel-c/include/hegel.h` (version 0.20.1, the context-based ABI).
Every fallible call takes a `hegel_context_t*` first argument and reports
diagnostics via `hegel_context_last_error(ctx)`. Lifecycle:
`hegel_run_start` → loop `hegel_next_test_case` (NULL = done) → per-case
primitives → `hegel_mark_complete` → `hegel_run_result`. See `src/libhegel.ts`
for the bound surface; the schema dicts the generators build are CBOR-encoded
and passed to `hegel_generate`.

## Tooling Choices

| Tool           | Package                        | Version         | Purpose                                                |
| -------------- | ------------------------------ | --------------- | ------------------------------------------------------ |
| TypeScript     | `typescript`                   | 5.9.3           | Type checking (`tsc --noEmit`), declaration generation |
| FFI            | `koffi`                        | 3.0.2           | Loading and calling the native libhegel C ABI          |
| CBOR           | `cbor-x`                       | 1.6.x           | Encoding schemas / decoding generated values           |
| Test Framework | `vitest`                       | 4.0.18          | Test runner, native TypeScript/ESM support             |
| Coverage       | `@vitest/coverage-v8`          | 4.0.18          | V8-based code coverage, enforces 100% thresholds       |
| Linter         | `eslint` + `typescript-eslint` | 10.0.2 / 8.56.1 | Type-aware linting with ESLint v10 flat config         |
| Formatter      | `prettier`                     | 3.8.1           | Code formatting                                        |
| Documentation  | `typedoc`                      | 0.28.17         | API docs from TSDoc comments                           |
| Runtime        | Node.js                        | 16.x            | LTS runtime (koffi ships prebuilt binaries for 16+)    |

### Build Commands Detail

- `just test` — `just fetch-libhegel` (download the host artifact into `.hegel/`
  and export `HEGEL_LIBHEGEL_PATH`), then `npx vitest run --coverage` and
  `python3 scripts/check-coverage.py`
- `just lint` — `npx prettier --check . && npx eslint . && npx tsc --noEmit`
- `just format` — `npx prettier --write .`
- `just docs` — `npx typedoc` (with `treatWarningsAsErrors: true`)
- `just fetch-libhegel` / `just build-libhegel` — obtain the native library
  (download the release, or build from a sibling `../hegel-rust`)

## Project Conventions

### File Layout

```
src/                 — Library source code (all production code)
  index.ts           — Public API entry point
  locate.ts          — Locate / download / verify the native libhegel library
  checksums.ts       — Pinned libhegel version + per-platform SHA-256 checksums
  libhegel.ts        — koffi bindings to the libhegel C ABI + typed `Libhegel` wrapper
  cbor.ts            — CBOR codec with the tag-91 (WTF-8 string) extension
  wtf8.ts            — WTF-8 decoder (lone-surrogate-preserving)
  session.ts         — Global lazy libhegel handle + version check
  runner.ts          — Test runner (`hegel.test`/`testAsync`, Settings, NativeDataSource)
  testCase.ts        — TestCase, Collection, Labels, DataSource, StopTestError, AssumeError
  generators/        — Generator implementations
    index.ts         — Re-exports the public generator surface
    core.ts          — Generator/BasicGenerator base classes
    numeric.ts       — integers, bigIntegers, floats, booleans
    strings.ts       — text, binary, fromRegex, emails, urls, dates, ...
    collections.ts   — arrays, sets, maps
    combinators.ts   — just, sampledFrom, oneOf, optional
    compose.ts       — composite, record
    tuples.ts        — tuples
tests/               — Test files (excluded from coverage)
  *.test.ts          — Vitest test files (one per module)
  libPath.ts         — Resolves the libhegel path for tests (env or .hegel/)
scripts/             — Build/CI scripts
  check-coverage.py  — Secondary coverage validation script
.hegel/              — Downloaded libhegel artifact for offline tests (gitignored)
README.md            — Project overview and quick start
dist/                — Compiled output (gitignored)
docs/                — Generated TypeDoc output (gitignored)
coverage/            — Coverage reports (gitignored)
```

### Naming Conventions

- Files: `kebab-case.ts` for source files, `kebab-case.test.ts` for tests
- Exports: `camelCase` for functions, `PascalCase` for classes/types/interfaces
- Constants: `UPPER_SNAKE_CASE`
- Private fields: prefix with `_` or use `#` private class fields

### Module System

- ESM (`"type": "module"` in package.json)
- Import with `.js` extension (required for Node16 module resolution)
- `tsconfig.json` uses `"module": "Node16"` and `"moduleResolution": "Node16"`

### Configuration Files

- `tsconfig.json` — TypeScript compiler options (strict mode enabled)
- `vitest.config.ts` — Test and coverage configuration
- `eslint.config.mjs` — ESLint flat config with typescript-eslint
- `.prettierrc` — Prettier formatting rules
- `typedoc.json` — TypeDoc documentation options

## Lessons Learned

### Native backend (libhegel via koffi)

- **Integer schema bounds must be CBOR integers.** cbor-x encodes plain JS
  numbers above 2³² as CBOR floats, which the engine's integer schema strictly
  rejects (`expected CBOR integer, got Float(...)`). Encode integer bounds as
  `bigint` (see `integers()`/`bigIntegers()` in `numeric.ts`). The float schema
  accepts integer-encoded bounds, so only the integer side needs this.
- **The engine has no unbounded integer.** `interpret_integer` requires both
  `min_value` and `max_value`. `bigIntegers()` with an open side defaults to the
  signed 128-bit range — the engine's bit-width-weighted draw makes a wide finite
  range behave like Hypothesis's unbounded distribution.
- **Generated strings come back as CBOR tag 91 wrapping WTF-8 bytes** (not a CBOR
  text string), so lone surrogates survive. `src/cbor.ts` registers the tag-91
  cbor-x extension → `wtf8ToString`; decode all values through it. This covers
  `string` and every string-shaped format generator (email/url/domain/date/…).
- **`hegel_generate` can return `HEGEL_E_ASSUME` (-2)**, not just `STOP_TEST`,
  when the engine rejects a draw internally (e.g. an email that exceeds length).
  Map it to `AssumeError` (discard the case), not a hard error.
- **koffi out-pointers**: declare `_Out_ void** out` / `_Out_ size_t* out_len`
  and pass single-element JS arrays (`[null]`, `[0]`); read the returned bytes
  with `Buffer.from(koffi.decode(out[0], "uint8_t", len))`. koffi does not free
  anything — free `Context`/`Settings`/`Run` explicitly in `finally`.
- **koffi types** are named exports, not properties of the default import:
  `import koffi, { type LibraryHandle } from "koffi"`. The FFI call boundary is
  inherently `any`; re-impose static types via a `Bindings` interface.
- **`spawnSync` + an in-process HTTP server deadlocks** — `spawnSync` blocks the
  event loop so the server never answers the child. The synchronous first-run
  downloader (`ensureLibrarySync`) runs a child `node` for exactly this reason;
  test the inline downloader program with async `spawn`, and the surrounding
  logic with injected `spawn` results.
- **`hegel.test` is synchronous**, so library resolution must be synchronous.
  The override (`HEGEL_LIBHEGEL_PATH`) and cache-hit paths are pure fs; only the
  one-time download shells out to a child process.

### General

- Vitest v4 with `@vitest/coverage-v8` provides built-in coverage thresholds that
  fail the test run if any metric drops below 100% — no external script needed for
  basic threshold enforcement. The `scripts/check-coverage.py` script is a secondary
  check that parses the JSON summary for more detailed reporting.
- ESLint v10 uses flat config exclusively (`eslint.config.mjs`). The `.eslintrc`
  format is no longer supported.
- TypeScript `"module": "Node16"` requires `.js` extensions in imports even though
  source files are `.ts`. This is the correct behavior for ESM Node.js projects.
- `"type": "module"` in package.json makes all `.js` files ESM by default. Use
  `.cjs` extension for any CommonJS files (like config files if needed).
- Add `@types/node` to devDependencies and `"types": ["node"]` in `tsconfig.json`
  to get types for `Buffer`, `net`, `zlib`, `module`, etc. Without this, TypeScript
  cannot find Node built-in types even with `@types/node` installed.
- **CRITICAL: JavaScript `<<` operator is 32-bit signed.** `(1 << 31)` equals
  `-2147483648`, not `2147483648`. Therefore `(1 << 31) - 1 = -2147483649`, not
  `2147483647`. Always use `2**31 - 1` or `0x7FFFFFFF` for the max non-reply message
  ID. Using `(1 << 31) - 1` causes `writeUInt32BE` to throw an out-of-range error.
- **Use readable (non-flowing) mode for sequential socket reads.** Multiple sequential
  `recvExact` calls with pause/resume (flowing mode) have a race condition: the `end`
  event can fire between calls while the socket is paused, causing `PartialPacketError`
  even though all data arrived. Switching to `readable` event + `socket.read()` (pull
  mode) eliminates this — data stays buffered and `socket.read()` returns it
  synchronously on the next call even after `end` fires.
- **`cbor-x` is the best CBOR library for TypeScript.** It is RFC 8949 compliant,
  ultra-fast, and ESM-friendly. Import as `import { encode, decode } from "cbor-x"`.
- **Re-exporting TypeScript interfaces with `isolatedModules: true`** requires
  `export type { Foo }` syntax. Plain `export { Foo }` causes a TS1205 error for
  interface/type re-exports.
- **CRC32 via Node built-in zlib.** `zlib.crc32(buf)` already returns an unsigned
  32-bit integer, so no `>>> 0` coercion is needed before `writeUInt32BE`. The `>>> 0`
  idiom is only required after bitwise operators (`|`, `&`, `^`, `<<`), which JavaScript
  evaluates as signed 32-bit. Import via `createRequire(import.meta.url)` in ESM context:
  `const zlib = require("zlib")`.
- **REPLY_BIT arithmetic.** `messageId | REPLY_BIT` can produce a negative JS integer
  because `<<` and `|` operate on signed 32-bit integers. Always apply `>>> 0` after
  the bitwise OR to convert to unsigned: `(messageId | REPLY_BIT) >>> 0`.
- **Demand-driven reader pattern.** Use `socket.setTimeout(ms)` + `SocketIdleTimeoutError`
  to periodically wake the reader loop and re-check `until()` without background threads.
  The `until()` predicate must be reachable from inside the reader loop — use a `satisfied`
  flag set by the consumer (not the ready-check itself) so `runReader` can exit promptly.
- **TCP coalesces writes.** In tests, even with delayed writes (`setTimeout`), data often
  arrives as a single chunk. To test partial-read paths, intercept `socket.read()` and
  control how many bytes are returned per call: read all available bytes with `origRead()`,
  split them, stash the second half, and return null on the loop's second call so `tryRead()`
  exits mid-packet. Then emit the event (timeout, etc.) before re-emitting `readable`.
- **ESLint flat config global ignores.** In ESLint v10 flat config, place `ignores` as a
  standalone first entry (`{ ignores: [...] }`) rather than inside the rule config object.
  Only top-level ignores entries apply globally across all files.
- **ESLint argsIgnorePattern for `_`-prefixed parameters.** Add `{ argsIgnorePattern: "^_",
varsIgnorePattern: "^_" }` to `@typescript-eslint/no-unused-vars` rule options so that
  intentionally unused parameters named `_` or `_foo` are not flagged as errors.
- **TypeDoc warns on unexported symbols referenced in JSDoc.** If `{@link Foo}` or
  `@throws {Foo}` appears in JSDoc but `Foo` is not in the public API, TypeDoc emits a
  warning that fails the docs build. Either export the symbol from `index.ts` or remove
  the reference from the JSDoc comment.
- **Hegel protocol field name is `stream_id`, not `stream`.** The `run_test` command
  must use `stream_id: testStream.streamId`, and `test_case` events send `stream_id`.
  Using the wrong key causes the server to never find the test stream and the connection
  to time out silently.
- **ESM module mocking in Vitest: `vi.spyOn` fails on frozen namespaces.** In Vitest ESM
  mode, `vi.spyOn(fs, "existsSync")` throws "Cannot assign to read only property" because
  ESM namespace objects are frozen. Use `vi.mock("node:fs", async (importOriginal) => {...})`
  at the top of the test file (hoisted before imports) and `vi.mocked(fs.existsSync)` to
  configure per-test behavior. The factory wraps each function in `vi.fn()`.
- **`AsyncLocalStorage` context: `undefined` vs `null`.** `getStore()` returns `undefined`
  when `run()` was never called (completely outside the context), `null` when `run(ctx, ...)`
  was called with `null`, and the context object inside a `run()` call. Distinguish all three
  states to correctly detect "not in test context" vs "in test infrastructure but no test case".
- **`process.on("exit", this._cleanupSync.bind(this))` instead of arrow wrapper.** Using
  `this._cleanupSync.bind(this)` avoids creating an anonymous arrow function that would
  be counted as an uncovered function by v8 coverage (since process exit never fires in tests).
- **Avoid fire-and-forget before `stream.close()`.** In `_runTestCase`'s finally block,
  `stream.sendRequest({command: "mark_complete"})` is fire-and-forget with `.catch(() => {})`.
  The underlying socket write is queued synchronously, so `stream.close()` immediately after
  is safe. But in test code overriding `_runTestCase`, always `await sendRequest(...)` before
  `close()` to ensure the packet is queued before the stream is destroyed.
- **Unhandled rejection warning from pending promise before handler attached.** When calling
  `session._start()` in a test and the promise will reject asynchronously (after fake timers
  advance), attach the rejection handler BEFORE advancing time: `const p = session._start();
const check = expect(p).rejects.toThrow(...); await advanceTimers(); await check;`. Without
  attaching a handler first, Node/Vitest fires "unhandled rejection" before the `expect` line runs.
- **v8 branch coverage tracks `??` operator branches individually.** `expr ?? defaultValue`
  generates two branches: one where `expr` is non-null/undefined (use `expr`) and one where
  it is null/undefined (use `defaultValue`). Defensive `?? fallback` patterns that are never
  hit in practice must be either tested or removed to achieve 100% branch coverage.
- **`extractOrigin` should prefer the first non-`node_modules` frame.** When parsing error
  stack traces, skip frames from `node_modules` (vitest internals) and use the first
  user-code frame. The fallback is the last parseable frame (for when all frames are internal).
- **`error_response` test mode does NOT throw.** The `error_response` HEGEL_PROTOCOL_TEST_MODE
  makes the server send a `RequestError` on the first `generate`, but the test body catches it
  and marks the case INTERESTING. The server then sends `test_done` with `interesting_test_cases=0`,
  so the overall test "passes". Tests expecting this mode to throw will fail — just verify it
  resolves.
- **v8 coverage counts anonymous arrow functions passed to APIs.** `process.on("exit", () => fn())`
  creates an anonymous function that v8 tracks separately. If that arrow is never invoked (process
  never exits), coverage drops below 100%. Use `.bind()` to pass the method directly, or expose
  the cleanup method for direct testing.
- **Concurrent `_start()` dedup via `_startPromise`.** Store the in-flight promise in `_startPromise`
  so concurrent callers await the same promise. Attach `.catch(() => {})` to `_startPromise` immediately
  after assignment to prevent Node's "unhandledRejection" warning if the promise rejects before
  the `await` catches it. The `.catch` creates a new handled promise without affecting the original.
- **Conformance binaries use `tsx` for TypeScript-native execution.** Add `tsx` to devDependencies
  and use `node --import tsx/esm script.ts` in wrapper shell scripts. The `build-conformance`
  justfile recipe generates shell wrapper scripts in `bin/conformance/` that call tsx with the
  absolute path to the conformance TypeScript source file.
- **Justfile heredocs with `--` flags cause parse errors.** The justfile parser tries to parse
  heredoc contents and trips on `--import`. Use `printf` or `echo` with escaped characters
  instead: `printf '#!/usr/bin/env bash\n...' > file`.
- **`CompositeListGenerator` must create a fresh `Collection` per `generate()` call.** The
  `Collection` object tracks `_finished = true` after `more()` returns false. If the generator
  is shared across test cases (defined outside the test body), a single `Collection` instance
  would stay finished after the first test case, generating only empty lists for all subsequent
  ones. Fix: create `new Collection(...)` inside `generate()`, not in the constructor.
- **`JSON.stringify` does NOT escape U+0085 (NEL), U+2028, U+2029.** Python's `str.splitlines()`
  splits on U+0085 (NEXT LINE), U+2028 (LINE SEPARATOR), and U+2029 (PARAGRAPH SEPARATOR).
  All three can appear in text strings generated by the hegel server. When writing JSONL metrics
  that will be read by Python, explicitly replace these characters: `.replace(/\u0085/g, "\\u0085")`
  etc. Regular control characters (\x00-\x1F) ARE escaped by JSON.stringify, but these three are not.
- **Use `CompositeListGenerator` (collection protocol) for `stop_test_on_collection_more` and
  `stop_test_on_new_collection` conformance tests.** The `BasicGenerator` list schema path does
  NOT exercise the collection protocol on the client side — the server handles `collection_more`
  internally and returns StopTest as a `generate` response. This causes the server to close the
  connection after StopTest, triggering `Error: Connection closed` in the main test loop. Using
  `lists(integers().filter(() => true), ...)` forces `CompositeListGenerator` which calls
  `new_collection` and `collection_more` explicitly, allowing the server to send StopTest in the
  collection commands and then send `test_done` normally.
- **Float exclude_min/exclude_max must only be set when bounds exist.** The hegel server returns
  `InvalidArgument: Cannot exclude min_value=None` when `exclude_min=true` but no `min_value` is
  set. Hypothesis may generate (and shrink to) params with `exclude_min: true, min_value: null`
  from its database even if the strategy guarantees otherwise. Guard: `excludeMin = minValue !== null && params.exclude_min`.
- **TypeDoc `readme` option renders README.md on the index page.** Add `"readme": "README.md"`
  to `typedoc.json` so the documentation index page shows the project README. This gives users
  a nice landing page with quick-start examples before diving into the API reference.
- **Examples directory does NOT need to be compiled or tested.** The `examples/` directory
  contains runnable TypeScript programs that demonstrate library usage. They are excluded from
  coverage measurement and ESLint/TypeScript checking. Keep them correct and idiomatic but
  do not add them to `tsconfig.json` or `vitest.config.ts`.
- **ESLint and Prettier must ignore `examples/`.** Add `examples/`
  to the ESLint global ignores block. The `docs/` directory is already ignored.
- **TypeDoc `treatWarningsAsErrors: true` catches broken `{@link}` references.** Any
  `{@link Foo}` or `@throws {Foo}` in JSDoc that references a non-exported symbol
  will fail the docs build. Always export symbols that appear in JSDoc links, or replace
  them with plain text.
- **Dead wrapper functions reduce readability with no benefit.** A function whose entire
  body is `return otherFunction(args)` is pure noise — the caller should call
  `otherFunction` directly. Remove such wrappers unless they serve a specific purpose
  (e.g. providing a different name, hiding a parameter, or enabling testing seams).
- **Consolidate same-module imports.** Two `import { ... } from "./same-module.js"` lines
  should always be merged into one. Duplicate imports from the same module are a lint
  smell that signals copy-paste maintenance.
- **`instanceof` is cleaner than duck-typed property checks.** `e instanceof RequestError`
  is more readable and type-safe than `e !== null && typeof e === "object" && "errorType" in e`.
  Prefer `instanceof` when the class is available.
- **README API signatures must match the actual function signatures.** Positional-parameter
  functions documented with option-object syntax (`lists(elements, { minSize?, maxSize? })`)
  confuse users. Keep the README code examples in sync with actual signatures.
- **`writePacket` should reuse a single header buffer.** Build the header with checksum=0,
  compute CRC32, then write the checksum into the same buffer. Do not allocate a second buffer
  and re-write all fields.
- **`readPacket` CRC check: zero the checksum field in place.** Instead of building a new
  buffer from three slices, just zero bytes 4-7 of the header buffer before computing CRC.
  The header buffer is a local variable that is not used after the check.
- **All functions have a `.name` property.** `Function.prototype.name` is part of ES2015.
  Do not cast `(fn as { name?: string }).name` — just use `fn.name` directly.
- **Remove dead guard clauses.** If a parameter is typed `Error | null`, checking
  `!== undefined` in addition to `!== null` is dead code.
- **`encodeValue` already returns `Buffer`.** Do not wrap `encodeValue(x)` in
  `Buffer.from(...)` — it creates an unnecessary copy. Pass the return value directly.
- **`childProcess.spawn` inherits `process.env` by default.** Do not pass
  `env: { ...process.env }` — it's a pointless spread that copies the entire env object.
- **Define sentinel symbols before using them.** `const` declarations are in a temporal
  dead zone before their declaration. Even though class field initializers run at
  construction time (so the symbol is defined by then), placing the symbol after the
  class that references it is confusing and non-idiomatic.
- **cbor-x `encode()` returns `Buffer` directly.** Do not wrap the result in `Buffer.from()`.
- **Extract `describeType(value)` helper for extractor error messages.** The pattern
  `value === null ? "null" : typeof value` appears in every CBOR extractor function.
  A shared `describeType` helper that also handles `Array.isArray` eliminates the
  repetition and keeps error messages consistent.
- **Use `0x80000000` for REPLY_BIT, not `1 << 31`.** JavaScript's `<<` returns a signed
  32-bit integer, so `1 << 31 === -2147483648`. This is confusing and inconsistent with the
  `CLOSE_STREAM_MESSAGE_ID` comment that warns against the same pattern. The hex literal
  `0x80000000` is `2147483648` (positive) and unambiguous. Bitwise operators still coerce it
  correctly for `|`, `&`, and `^` operations.
- **Don't pass default arguments explicitly.** When `stopSpan()` defaults `discard` to `false`,
  writing `stopSpan({ discard: false })` in 13 places is noise. Only pass `{ discard: true }`
  when overriding the default.
- **Span helpers must use try/finally.** `group()` must call `stopSpan()` in a `finally` block
  so the span is always closed, even if `fn()` throws. Otherwise a thrown exception (including
  `DataExhausted`) leaves the span open, corrupting the server's span stack.
- **`err.constructor?.name` optional chaining is intentional.** In `extractOrigin`, the
  parameter is typed `Error`, but callers may cast arbitrary objects to `Error` (e.g. in
  `_runTestCase`'s catch block with `e instanceof Error ? e : new Error(String(e))`). In the
  test suite, an object with `constructor: undefined` is used to exercise the fallback. The
  `?.` is not dead defensive code — it handles real edge cases in a dynamically-typed language.
