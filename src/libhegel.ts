/**
 * Thin, typed binding to the native `libhegel` C ABI (see
 * `hegel-rust/hegel-c/include/hegel.h`, version 0.20.1) via {@link koffi}.
 *
 * The {@link Libhegel} class owns the loaded library's function pointers and
 * exposes ergonomic wrappers: opaque handles are passed around as untyped
 * pointers, `int`-returning fallible calls are mapped to thrown errors
 * ({@link StopTestError} for the choice-budget-exhausted case, otherwise
 * {@link LibhegelError} carrying the diagnostic from `hegel_context_last_error`),
 * and the `hegel_generate` out-pointer is read back into a {@link Buffer}.
 *
 * libhegel does not free anything for you: every handle from a constructor
 * (`hegel_context_new`, `hegel_settings_new`, `hegel_run_start`) must be
 * released by the caller (the runner does so in `finally` blocks). Test cases
 * from `hegel_next_test_case` are borrowed and released by `hegel_run_free`.
 *
 * @packageDocumentation
 */

import koffi, { type LibraryHandle } from "koffi";
import { StopTestError, AssumeError } from "./testCase.js";

/** Opaque libhegel handle (koffi pointer). `null` signals a failed call. */
export type Ptr = unknown;

/** `hegel_status_t` — outcome of a single test case. */
export const Status = {
  VALID: 0,
  INVALID: 1,
  OVERRUN: 2,
  INTERESTING: 3,
} as const;

/** `hegel_run_status_t` — aggregate outcome of a finished run. */
export const RunStatus = {
  PASSED: 0,
  FAILED: 1,
  ERROR: 2,
} as const;

/** `hegel_verbosity_t`. */
export const NativeVerbosity = {
  QUIET: 0,
  NORMAL: 1,
  VERBOSE: 2,
  DEBUG: 3,
} as const;

/** Relevant `hegel_result_t` codes. */
const RESULT_OK = 0;
const RESULT_STOP_TEST = -1;
const RESULT_ASSUME = -2;

/** An error returned by a fallible libhegel call. */
export class LibhegelError extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.name = "LibhegelError";
    this.code = code;
  }
}

/** The set of C functions bound from the shared library. */
export interface Bindings {
  contextNew: () => Ptr;
  contextFree: (ctx: Ptr) => void;
  contextLastError: (ctx: Ptr) => string | null;

  settingsNew: () => Ptr;
  settingsFree: (s: Ptr) => void;
  settingsTestCases: (s: Ptr, n: number) => void;
  settingsVerbosity: (s: Ptr, v: number) => void;
  settingsSeed: (s: Ptr, seed: bigint, hasSeed: boolean) => void;
  settingsDerandomize: (s: Ptr, on: boolean) => void;
  settingsDatabase: (ctx: Ptr, s: Ptr, db: string | null) => void;
  settingsDatabaseKey: (ctx: Ptr, s: Ptr, key: string | null) => void;
  settingsSuppressHealthCheck: (s: Ptr, checks: number) => void;

  runStart: (ctx: Ptr, settings: Ptr) => Ptr;
  nextTestCase: (ctx: Ptr, run: Ptr) => Ptr;
  runResult: (ctx: Ptr, run: Ptr) => Ptr;
  runFree: (run: Ptr) => void;

  generate: (
    ctx: Ptr,
    tc: Ptr,
    schema: Buffer,
    schemaLen: number,
    out: Ptr[],
    outLen: (number | bigint)[],
  ) => number;
  startSpan: (ctx: Ptr, tc: Ptr, label: number) => number;
  stopSpan: (ctx: Ptr, tc: Ptr, discard: boolean) => number;
  newCollection: (ctx: Ptr, tc: Ptr, min: number, max: bigint, out: (number | bigint)[]) => number;
  collectionMore: (ctx: Ptr, tc: Ptr, id: bigint, out: boolean[]) => number;
  collectionReject: (ctx: Ptr, tc: Ptr, id: bigint, why: string | null) => number;
  markComplete: (ctx: Ptr, tc: Ptr, status: number, origin: string | null) => number;
  isFinalReplay: (tc: Ptr) => boolean;

  runResultStatus: (r: Ptr) => number;
  runResultError: (r: Ptr) => string | null;
  runResultFailureCount: (r: Ptr) => number;
  runResultFailure: (r: Ptr, index: number) => Ptr;
  failurePanicMessage: (f: Ptr) => string | null;
  failureOrigin: (f: Ptr) => string | null;

  version: () => string;
}

/**
 * Bind every libhegel function used by the client against a loaded koffi
 * library handle.
 */
export function bindLibrary(lib: LibraryHandle): Bindings {
  // The koffi FFI boundary is inherently dynamically typed; `Bindings` re-imposes
  // static types on the wrappers below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f = (proto: string): ((...args: any[]) => any) => lib.func(proto);
  const contextNew = f("void* hegel_context_new()");
  const contextFree = f("void hegel_context_free(void* ctx)");
  const contextLastError = f("const char* hegel_context_last_error(void* ctx)");

  const settingsNew = f("void* hegel_settings_new()");
  const settingsFree = f("void hegel_settings_free(void* s)");
  const settingsTestCases = f("void hegel_settings_test_cases(void* s, uint64_t n)");
  const settingsVerbosity = f("void hegel_settings_verbosity(void* s, int v)");
  const settingsSeed = f("void hegel_settings_seed(void* s, uint64_t seed, bool has_seed)");
  const settingsDerandomize = f("void hegel_settings_derandomize(void* s, bool d)");
  const settingsDatabase = f("void hegel_settings_database(void* ctx, void* s, const char* db)");
  const settingsDatabaseKey = f(
    "void hegel_settings_database_key(void* ctx, void* s, const char* key)",
  );
  const settingsSuppressHealthCheck = f(
    "void hegel_settings_suppress_health_check(void* s, uint32_t checks)",
  );

  const runStart = f("void* hegel_run_start(void* ctx, void* settings)");
  const nextTestCase = f("void* hegel_next_test_case(void* ctx, void* run)");
  const runResult = f("void* hegel_run_result(void* ctx, void* run)");
  const runFree = f("void hegel_run_free(void* run)");

  const generate = f(
    "int hegel_generate(void* ctx, void* tc, uint8_t* schema, size_t schema_len, _Out_ void** out, _Out_ size_t* out_len)",
  );
  const startSpan = f("int hegel_start_span(void* ctx, void* tc, uint64_t label)");
  const stopSpan = f("int hegel_stop_span(void* ctx, void* tc, bool discard)");
  const newCollection = f(
    "int hegel_new_collection(void* ctx, void* tc, uint64_t min, uint64_t max, _Out_ int64_t* out)",
  );
  const collectionMore = f(
    "int hegel_collection_more(void* ctx, void* tc, int64_t id, _Out_ bool* out)",
  );
  const collectionReject = f(
    "int hegel_collection_reject(void* ctx, void* tc, int64_t id, const char* why)",
  );
  const markComplete = f(
    "int hegel_mark_complete(void* ctx, void* tc, int status, const char* origin)",
  );
  const isFinalReplay = f("bool hegel_test_case_is_final_replay(void* tc)");

  const runResultStatus = f("int hegel_run_result_status(void* r)");
  const runResultError = f("const char* hegel_run_result_error(void* r)");
  const runResultFailureCount = f("size_t hegel_run_result_failure_count(void* r)");
  const runResultFailure = f("void* hegel_run_result_failure(void* r, size_t index)");
  const failurePanicMessage = f("const char* hegel_failure_panic_message(void* f)");
  const failureOrigin = f("const char* hegel_failure_origin(void* f)");
  const version = f("const char* hegel_version()");

  return {
    contextNew: () => contextNew(),
    contextFree: (ctx) => contextFree(ctx),
    contextLastError: (ctx) => contextLastError(ctx),
    settingsNew: () => settingsNew(),
    settingsFree: (s) => settingsFree(s),
    settingsTestCases: (s, n) => settingsTestCases(s, n),
    settingsVerbosity: (s, v) => settingsVerbosity(s, v),
    settingsSeed: (s, seed, hasSeed) => settingsSeed(s, seed, hasSeed),
    settingsDerandomize: (s, on) => settingsDerandomize(s, on),
    settingsDatabase: (ctx, s, db) => settingsDatabase(ctx, s, db),
    settingsDatabaseKey: (ctx, s, key) => settingsDatabaseKey(ctx, s, key),
    settingsSuppressHealthCheck: (s, checks) => settingsSuppressHealthCheck(s, checks),
    runStart: (ctx, s) => runStart(ctx, s),
    nextTestCase: (ctx, run) => nextTestCase(ctx, run),
    runResult: (ctx, run) => runResult(ctx, run),
    runFree: (run) => runFree(run),
    generate: (ctx, tc, schema, schemaLen, out, outLen) =>
      generate(ctx, tc, schema, schemaLen, out, outLen),
    startSpan: (ctx, tc, label) => startSpan(ctx, tc, label),
    stopSpan: (ctx, tc, discard) => stopSpan(ctx, tc, discard),
    newCollection: (ctx, tc, min, max, out) => newCollection(ctx, tc, min, max, out),
    collectionMore: (ctx, tc, id, out) => collectionMore(ctx, tc, id, out),
    collectionReject: (ctx, tc, id, why) => collectionReject(ctx, tc, id, why),
    markComplete: (ctx, tc, status, origin) => markComplete(ctx, tc, status, origin),
    isFinalReplay: (tc) => isFinalReplay(tc),
    runResultStatus: (r) => runResultStatus(r),
    runResultError: (r) => runResultError(r),
    runResultFailureCount: (r) => Number(runResultFailureCount(r)),
    runResultFailure: (r, index) => runResultFailure(r, index),
    failurePanicMessage: (fp) => failurePanicMessage(fp),
    failureOrigin: (fp) => failureOrigin(fp),
    version: () => version(),
  };
}

const UINT64_MAX = 0xffffffffffffffffn;

/**
 * High-level wrapper over the libhegel C ABI.
 */
export class Libhegel {
  private readonly fns: Bindings;

  constructor(fns: Bindings) {
    this.fns = fns;
  }

  /** Load libhegel from a shared-library path. */
  static load(path: string): Libhegel {
    return new Libhegel(bindLibrary(koffi.load(path)));
  }

  version(): string {
    return this.fns.version();
  }

  newContext(): Ptr {
    return this.fns.contextNew();
  }

  freeContext(ctx: Ptr): void {
    this.fns.contextFree(ctx);
  }

  lastError(ctx: Ptr): string {
    return this.fns.contextLastError(ctx) ?? "";
  }

  newSettings(): Ptr {
    return this.fns.settingsNew();
  }

  freeSettings(s: Ptr): void {
    this.fns.settingsFree(s);
  }

  setTestCases(s: Ptr, n: number): void {
    this.fns.settingsTestCases(s, n);
  }

  setVerbosity(s: Ptr, v: number): void {
    this.fns.settingsVerbosity(s, v);
  }

  setSeed(s: Ptr, seed: bigint): void {
    this.fns.settingsSeed(s, seed, true);
  }

  setDerandomize(s: Ptr, on: boolean): void {
    this.fns.settingsDerandomize(s, on);
  }

  setDatabase(ctx: Ptr, s: Ptr, db: string | null): void {
    this.fns.settingsDatabase(ctx, s, db);
  }

  setDatabaseKey(ctx: Ptr, s: Ptr, key: string): void {
    this.fns.settingsDatabaseKey(ctx, s, key);
  }

  setSuppressHealthCheck(s: Ptr, checks: number): void {
    this.fns.settingsSuppressHealthCheck(s, checks);
  }

  /** Start a run. Throws {@link LibhegelError} on failure. */
  runStart(ctx: Ptr, settings: Ptr): Ptr {
    const run = this.fns.runStart(ctx, settings);
    if (run === null) {
      throw new LibhegelError(`hegel_run_start failed: ${this.lastError(ctx)}`, -1);
    }
    return run;
  }

  /**
   * Pull the next test case, or `null` when the run is finished. Throws if the
   * engine reported a mid-run error.
   */
  nextTestCase(ctx: Ptr, run: Ptr): Ptr | null {
    const tc = this.fns.nextTestCase(ctx, run);
    if (tc === null) {
      const err = this.lastError(ctx);
      if (err !== "") {
        throw new LibhegelError(`hegel_next_test_case failed: ${err}`, -1);
      }
      return null;
    }
    return tc;
  }

  /** Read the aggregated run result. Throws on failure. */
  runResult(ctx: Ptr, run: Ptr): Ptr {
    const r = this.fns.runResult(ctx, run);
    if (r === null) {
      throw new LibhegelError(`hegel_run_result failed: ${this.lastError(ctx)}`, -1);
    }
    return r;
  }

  freeRun(run: Ptr): void {
    this.fns.runFree(run);
  }

  /**
   * Map a fallible `int`-returning result code to an exception.
   * `HEGEL_E_STOP_TEST` becomes {@link StopTestError}; any other non-OK code
   * becomes a {@link LibhegelError} carrying the context diagnostic.
   */
  private check(ctx: Ptr, code: number, op: string): void {
    if (code === RESULT_OK) {
      return;
    }
    if (code === RESULT_STOP_TEST) {
      throw new StopTestError();
    }
    if (code === RESULT_ASSUME) {
      // The engine rejected this draw (e.g. a format generator's internal
      // precondition failed); discard the test case like a failed assume().
      throw new AssumeError();
    }
    throw new LibhegelError(`${op} failed: ${this.lastError(ctx)}`, code);
  }

  /** Draw a CBOR value for the given CBOR-encoded schema. */
  generate(ctx: Ptr, tc: Ptr, schema: Buffer): Buffer {
    const out: Ptr[] = [null];
    const outLen: (number | bigint)[] = [0];
    const code = this.fns.generate(ctx, tc, schema, schema.length, out, outLen);
    this.check(ctx, code, "hegel_generate");
    const len = Number(outLen[0]);
    return Buffer.from(koffi.decode(out[0], "uint8_t", len) as number[]);
  }

  startSpan(ctx: Ptr, tc: Ptr, label: number): void {
    this.check(ctx, this.fns.startSpan(ctx, tc, label), "hegel_start_span");
  }

  stopSpan(ctx: Ptr, tc: Ptr, discard: boolean): void {
    this.check(ctx, this.fns.stopSpan(ctx, tc, discard), "hegel_stop_span");
  }

  newCollection(ctx: Ptr, tc: Ptr, min: number, max?: number): bigint {
    const out: (number | bigint)[] = [0];
    const maxArg = max === undefined ? UINT64_MAX : BigInt(max);
    this.check(ctx, this.fns.newCollection(ctx, tc, min, maxArg, out), "hegel_new_collection");
    return BigInt(out[0]);
  }

  collectionMore(ctx: Ptr, tc: Ptr, id: bigint): boolean {
    const out: boolean[] = [false];
    this.check(ctx, this.fns.collectionMore(ctx, tc, id, out), "hegel_collection_more");
    return out[0];
  }

  collectionReject(ctx: Ptr, tc: Ptr, id: bigint, why: string | null): void {
    this.check(ctx, this.fns.collectionReject(ctx, tc, id, why), "hegel_collection_reject");
  }

  markComplete(ctx: Ptr, tc: Ptr, status: number, origin: string | null): void {
    this.check(ctx, this.fns.markComplete(ctx, tc, status, origin), "hegel_mark_complete");
  }

  isFinalReplay(tc: Ptr): boolean {
    return this.fns.isFinalReplay(tc);
  }

  runStatus(r: Ptr): number {
    return this.fns.runResultStatus(r);
  }

  runError(r: Ptr): string | null {
    return this.fns.runResultError(r);
  }

  failureCount(r: Ptr): number {
    return this.fns.runResultFailureCount(r);
  }

  failure(r: Ptr, index: number): Ptr {
    return this.fns.runResultFailure(r, index);
  }

  failurePanicMessage(fp: Ptr): string {
    return this.fns.failurePanicMessage(fp) ?? "";
  }

  failureOrigin(fp: Ptr): string {
    return this.fns.failureOrigin(fp) ?? "";
  }
}
