/**
 * Thin, typed binding to the native `libhegel` C ABI (see
 * `hegel-rust/hegel-c/include/hegel.h`, version 0.23.0) via Deno FFI.
 *
 * The {@link Libhegel} class owns the loaded library and exposes ergonomic
 * wrappers. Every fallible call takes a `hegel_context_t*` first argument and
 * returns a `hegel_result_t` code (`HEGEL_OK` is zero; negatives are errors),
 * writing any value it produces through a trailing out-parameter.
 *
 * libhegel frees nothing for you: every handle from a constructor
 * (`hegel_context_new`, `hegel_settings_new`, `hegel_run_start`,
 * `hegel_test_case_from_blob`) must be released by the caller with its matching
 * free. Test cases from `hegel_next_test_case` are borrowed and released by
 * `hegel_run_free`.
 *
 * @packageDocumentation
 */

import { AssumeError, StopTestError } from "./testCase.ts";

export type Ptr = Deno.PointerValue;

export const Status = {
  VALID: 0,
  INVALID: 1,
  OVERRUN: 2,
  INTERESTING: 3,
} as const;

export const RunStatus = {
  PASSED: 0,
  FAILED: 1,
  ERROR: 2,
} as const;

export const NativeVerbosity = {
  QUIET: 0,
  NORMAL: 1,
  VERBOSE: 2,
  DEBUG: 3,
} as const;

const RESULT_OK = 0;
const RESULT_STOP_TEST = -1;
const RESULT_ASSUME = -2;
const UINT64_MAX = 0xffffffffffffffffn;
const encoder = new TextEncoder();

const symbols = {
  hegel_context_new: { parameters: [], result: "pointer" },
  hegel_context_free: { parameters: ["pointer"], result: "void" },
  hegel_context_last_error: { parameters: ["pointer"], result: "pointer" },
  hegel_settings_new: { parameters: ["pointer", "buffer"], result: "i32" },
  hegel_settings_free: { parameters: ["pointer", "pointer"], result: "void" },
  hegel_settings_set_test_cases: {
    parameters: ["pointer", "pointer", "u64"],
    result: "i32",
  },
  hegel_settings_set_verbosity: {
    parameters: ["pointer", "pointer", "i32"],
    result: "i32",
  },
  hegel_settings_set_seed: {
    parameters: ["pointer", "pointer", "u64", "bool"],
    result: "i32",
  },
  hegel_settings_set_derandomize: {
    parameters: ["pointer", "pointer", "bool"],
    result: "i32",
  },
  hegel_settings_set_database: {
    parameters: ["pointer", "pointer", "buffer"],
    result: "i32",
  },
  hegel_settings_set_database_key: {
    parameters: ["pointer", "pointer", "buffer"],
    result: "i32",
  },
  hegel_settings_set_suppress_health_check: {
    parameters: ["pointer", "pointer", "u32"],
    result: "i32",
  },
  hegel_settings_set_report_multiple_failures: {
    parameters: ["pointer", "pointer", "bool"],
    result: "i32",
  },
  hegel_run_start: {
    parameters: ["pointer", "pointer", "buffer"],
    result: "i32",
  },
  hegel_next_test_case: {
    parameters: ["pointer", "pointer", "buffer"],
    result: "i32",
  },
  hegel_run_result: {
    parameters: ["pointer", "pointer", "buffer"],
    result: "i32",
  },
  hegel_run_free: { parameters: ["pointer", "pointer"], result: "void" },
  hegel_test_case_from_blob: {
    parameters: ["pointer", "pointer", "buffer", "buffer"],
    result: "i32",
  },
  hegel_test_case_free: { parameters: ["pointer", "pointer"], result: "void" },
  hegel_generate: {
    parameters: ["pointer", "pointer", "buffer", "usize", "buffer", "buffer"],
    result: "i32",
  },
  hegel_start_span: {
    parameters: ["pointer", "pointer", "u64"],
    result: "i32",
  },
  hegel_stop_span: {
    parameters: ["pointer", "pointer", "bool"],
    result: "i32",
  },
  hegel_new_collection: {
    parameters: ["pointer", "pointer", "u64", "u64", "buffer"],
    result: "i32",
  },
  hegel_collection_more: {
    parameters: ["pointer", "pointer", "i64", "buffer"],
    result: "i32",
  },
  hegel_collection_reject: {
    parameters: ["pointer", "pointer", "i64", "buffer"],
    result: "i32",
  },
  hegel_mark_complete: {
    parameters: ["pointer", "pointer", "i32", "buffer"],
    result: "i32",
  },
  hegel_run_result_status: {
    parameters: ["pointer", "pointer", "buffer"],
    result: "i32",
  },
  hegel_run_result_error: {
    parameters: ["pointer", "pointer", "buffer"],
    result: "i32",
  },
  hegel_run_result_failure_count: {
    parameters: ["pointer", "pointer", "buffer"],
    result: "i32",
  },
  hegel_run_result_failure: {
    parameters: ["pointer", "pointer", "usize", "buffer"],
    result: "i32",
  },
  hegel_failure_origin: {
    parameters: ["pointer", "pointer", "buffer"],
    result: "i32",
  },
  hegel_failure_reproduction_blob: {
    parameters: ["pointer", "pointer", "buffer"],
    result: "i32",
  },
  hegel_version: { parameters: ["pointer", "buffer"], result: "i32" },
} as const satisfies Deno.ForeignLibraryInterface;

function pointerOut(): BigUint64Array {
  return new BigUint64Array(1);
}

function readPointer(out: BigUint64Array): Ptr {
  return out[0] === 0n ? null : Deno.UnsafePointer.create(out[0]);
}

function cString(value: string | null): Uint8Array | null {
  if (value === null) return null;
  const bytes = encoder.encode(value);
  const terminated = new Uint8Array(bytes.length + 1);
  terminated.set(bytes);
  return terminated;
}

function readCString(pointer: Ptr): string | null {
  return pointer === null ? null : new Deno.UnsafePointerView(pointer).getCString();
}

export class LibhegelError extends Error {
  readonly code: number;

  constructor(message: string, code: number) {
    super(message);
    this.name = "LibhegelError";
    this.code = code;
  }
}

export class Libhegel {
  private constructor(private readonly library: Deno.DynamicLibrary<typeof symbols>) {}

  static load(path: string): Libhegel {
    return new Libhegel(Deno.dlopen(path, symbols));
  }

  version(): string {
    const out = pointerOut();
    this.library.symbols.hegel_version(null, out);
    return readCString(readPointer(out)) ?? "";
  }

  newContext(): Ptr {
    return this.library.symbols.hegel_context_new();
  }

  freeContext(ctx: Ptr): void {
    this.library.symbols.hegel_context_free(ctx);
  }

  lastError(ctx: Ptr): string {
    return readCString(this.library.symbols.hegel_context_last_error(ctx)) ?? "";
  }

  newSettings(): Ptr {
    const out = pointerOut();
    this.library.symbols.hegel_settings_new(null, out);
    return readPointer(out);
  }

  freeSettings(settings: Ptr): void {
    this.library.symbols.hegel_settings_free(null, settings);
  }

  setTestCases(settings: Ptr, count: number): void {
    this.library.symbols.hegel_settings_set_test_cases(null, settings, BigInt(count));
  }

  setVerbosity(settings: Ptr, verbosity: number): void {
    this.library.symbols.hegel_settings_set_verbosity(null, settings, verbosity);
  }

  setSeed(settings: Ptr, seed: bigint): void {
    this.library.symbols.hegel_settings_set_seed(null, settings, seed, true);
  }

  setDerandomize(settings: Ptr, enabled: boolean): void {
    this.library.symbols.hegel_settings_set_derandomize(null, settings, enabled);
  }

  setDatabase(ctx: Ptr, settings: Ptr, database: string | null): void {
    this.library.symbols.hegel_settings_set_database(ctx, settings, cString(database));
  }

  setDatabaseKey(ctx: Ptr, settings: Ptr, key: string): void {
    this.library.symbols.hegel_settings_set_database_key(ctx, settings, cString(key));
  }

  setSuppressHealthCheck(settings: Ptr, checks: number): void {
    this.library.symbols.hegel_settings_set_suppress_health_check(null, settings, checks);
  }

  setReportMultipleFailures(settings: Ptr, enabled: boolean): void {
    this.library.symbols.hegel_settings_set_report_multiple_failures(null, settings, enabled);
  }

  runStart(ctx: Ptr, settings: Ptr): Ptr {
    const out = pointerOut();
    this.check(ctx, this.library.symbols.hegel_run_start(ctx, settings, out), "hegel_run_start");
    return readPointer(out);
  }

  nextTestCase(ctx: Ptr, run: Ptr): Ptr | null {
    const out = pointerOut();
    this.check(
      ctx,
      this.library.symbols.hegel_next_test_case(ctx, run, out),
      "hegel_next_test_case",
    );
    return readPointer(out);
  }

  runResult(ctx: Ptr, run: Ptr): Ptr {
    const out = pointerOut();
    this.check(ctx, this.library.symbols.hegel_run_result(ctx, run, out), "hegel_run_result");
    return readPointer(out);
  }

  freeRun(run: Ptr): void {
    this.library.symbols.hegel_run_free(null, run);
  }

  testCaseFromBlob(ctx: Ptr, settings: Ptr, blob: string | null): Ptr {
    const out = pointerOut();
    this.check(
      ctx,
      this.library.symbols.hegel_test_case_from_blob(ctx, settings, cString(blob), out),
      "hegel_test_case_from_blob",
    );
    return readPointer(out);
  }

  freeTestCase(testCase: Ptr): void {
    this.library.symbols.hegel_test_case_free(null, testCase);
  }

  generate(ctx: Ptr, testCase: Ptr, schema: Uint8Array): Uint8Array {
    const out = pointerOut();
    const outLength = new BigUint64Array(1);
    const code = this.library.symbols.hegel_generate(
      ctx,
      testCase,
      schema,
      BigInt(schema.length),
      out,
      outLength,
    );
    this.check(ctx, code, "hegel_generate");

    const length = Number(outLength[0]);
    if (length === 0) return new Uint8Array();
    const pointer = readPointer(out);
    if (pointer === null) {
      throw new Error("hegel_generate returned a null buffer");
    }
    return new Uint8Array(new Deno.UnsafePointerView(pointer).getArrayBuffer(length)).slice();
  }

  startSpan(ctx: Ptr, testCase: Ptr, label: number): void {
    this.check(
      ctx,
      this.library.symbols.hegel_start_span(ctx, testCase, BigInt(label)),
      "hegel_start_span",
    );
  }

  stopSpan(ctx: Ptr, testCase: Ptr, discard: boolean): void {
    this.check(
      ctx,
      this.library.symbols.hegel_stop_span(ctx, testCase, discard),
      "hegel_stop_span",
    );
  }

  newCollection(ctx: Ptr, testCase: Ptr, min: number, max?: number): bigint {
    const out = new BigInt64Array(1);
    this.check(
      ctx,
      this.library.symbols.hegel_new_collection(
        ctx,
        testCase,
        BigInt(min),
        max === undefined ? UINT64_MAX : BigInt(max),
        out,
      ),
      "hegel_new_collection",
    );
    return out[0];
  }

  collectionMore(ctx: Ptr, testCase: Ptr, id: bigint): boolean {
    const out = new Uint8Array(1);
    this.check(
      ctx,
      this.library.symbols.hegel_collection_more(ctx, testCase, id, out),
      "hegel_collection_more",
    );
    return out[0] !== 0;
  }

  collectionReject(ctx: Ptr, testCase: Ptr, id: bigint, why: string | null): void {
    this.check(
      ctx,
      this.library.symbols.hegel_collection_reject(ctx, testCase, id, cString(why)),
      "hegel_collection_reject",
    );
  }

  markComplete(ctx: Ptr, testCase: Ptr, status: number, origin: string | null): void {
    this.check(
      ctx,
      this.library.symbols.hegel_mark_complete(ctx, testCase, status, cString(origin)),
      "hegel_mark_complete",
    );
  }

  runStatus(result: Ptr): number {
    const out = new Int32Array(1);
    this.library.symbols.hegel_run_result_status(null, result, out);
    return out[0];
  }

  runError(result: Ptr): string | null {
    const out = pointerOut();
    this.library.symbols.hegel_run_result_error(null, result, out);
    return readCString(readPointer(out));
  }

  failureCount(result: Ptr): number {
    const out = new BigUint64Array(1);
    this.library.symbols.hegel_run_result_failure_count(null, result, out);
    return Number(out[0]);
  }

  failure(result: Ptr, index: number): Ptr {
    const out = pointerOut();
    this.library.symbols.hegel_run_result_failure(null, result, BigInt(index), out);
    return readPointer(out);
  }

  failureOrigin(failure: Ptr): string {
    const out = pointerOut();
    this.library.symbols.hegel_failure_origin(null, failure, out);
    return readCString(readPointer(out)) ?? "";
  }

  reproductionBlob(failure: Ptr): string | null {
    const out = pointerOut();
    this.library.symbols.hegel_failure_reproduction_blob(null, failure, out);
    return readCString(readPointer(out));
  }

  private check(ctx: Ptr, code: number, operation: string): void {
    if (code === RESULT_OK) return;
    if (code === RESULT_STOP_TEST) throw new StopTestError();
    if (code === RESULT_ASSUME) throw new AssumeError();
    throw new LibhegelError(`${operation} failed: ${this.lastError(ctx)}`, code);
  }
}
