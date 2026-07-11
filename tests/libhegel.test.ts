import { describe, it, expect } from "./_deps.ts";
import { encode, decode } from "npm:cbor-x@1.6.0";
import {
  Libhegel,
  LibhegelError,
  Status,
  RunStatus,
  NativeVerbosity,
  type Ptr,
} from "../src/libhegel.ts";
import { StopTestError, Labels } from "../src/testCase.ts";
import { testLibPath } from "./libPath.ts";

// ---------------------------------------------------------------------------
// Integration tests against the real libhegel shared library.
// ---------------------------------------------------------------------------

/** Drive a run of `property` over a CBOR integer schema; return the result. */
function driveIntegerRun(
  lib: Libhegel,
  property: (n: number) => boolean,
  opts: { testCases?: number } = {},
): { status: number; failureOrigin?: string; reproductionBlob?: string | null } {
  const ctx = lib.newContext();
  const settings = lib.newSettings();
  let run: Ptr | undefined;
  try {
    lib.setTestCases(settings, opts.testCases ?? 200);
    lib.setVerbosity(settings, NativeVerbosity.QUIET);
    lib.setDerandomize(settings, true);
    lib.setSeed(settings, 12345n);
    lib.setDatabase(ctx, settings, ""); // disable persistence
    lib.setSuppressHealthCheck(settings, 0);
    run = lib.runStart(ctx, settings);
    const schema = Buffer.from(encode({ type: "integer", min_value: -1000, max_value: 1000 }));

    for (;;) {
      const tc = lib.nextTestCase(ctx, run);
      if (tc === null) break;
      let status: number = Status.VALID;
      let origin: string | null = null;
      try {
        const value = decode(lib.generate(ctx, tc, schema)) as number;
        if (!property(value)) {
          status = Status.INTERESTING;
          origin = "test:integerRun";
        }
      } catch (e) {
        if (e instanceof StopTestError) {
          status = Status.OVERRUN;
        } else {
          throw e;
        }
      }
      lib.markComplete(ctx, tc, status, origin);
    }

    const result = lib.runResult(ctx, run);
    const status = lib.runStatus(result);
    if (status === RunStatus.FAILED && lib.failureCount(result) > 0) {
      const f = lib.failure(result, 0);
      return {
        status,
        failureOrigin: lib.failureOrigin(f),
        reproductionBlob: lib.reproductionBlob(f),
      };
    }
    return { status };
  } finally {
    if (run !== undefined) lib.freeRun(run);
    lib.freeSettings(settings);
    lib.freeContext(ctx);
  }
}

describe("Libhegel against the real library", () => {
  const lib = Libhegel.load(testLibPath());

  it("reports the expected version", () => {
    expect(lib.version()).toBe("0.23.0");
  });

  it("passes a property that always holds", () => {
    const res = driveIntegerRun(lib, (n) => n >= -1000 && n <= 1000);
    expect(res.status).toBe(RunStatus.PASSED);
  });

  it("fails and surfaces a failure with origin and a reproduce blob for a false property", () => {
    const res = driveIntegerRun(lib, (n) => n < 50);
    expect(res.status).toBe(RunStatus.FAILED);
    expect(res.failureOrigin).toBe("test:integerRun");
    expect(typeof res.reproductionBlob).toBe("string");
  });

  it("throws a LibhegelError on a malformed schema", () => {
    const ctx = lib.newContext();
    const settings = lib.newSettings();
    lib.setVerbosity(settings, NativeVerbosity.QUIET);
    lib.setDatabase(ctx, settings, "");
    const run = lib.runStart(ctx, settings);
    try {
      const tc = lib.nextTestCase(ctx, run);
      expect(tc !== null).toBe(true);
      // Not valid CBOR for a schema -> engine rejects it.
      expect(() => lib.generate(ctx, tc, Buffer.from([0xff, 0xff, 0xff]))).toThrow(LibhegelError);
      lib.markComplete(ctx, tc, Status.INVALID, null);
    } finally {
      lib.freeRun(run);
      lib.freeSettings(settings);
      lib.freeContext(ctx);
    }
  });

  it("throws when next_test_case is called before completing the previous case", () => {
    const ctx = lib.newContext();
    const settings = lib.newSettings();
    lib.setVerbosity(settings, NativeVerbosity.QUIET);
    lib.setDatabase(ctx, settings, "");
    const run = lib.runStart(ctx, settings);
    try {
      const tc = lib.nextTestCase(ctx, run);
      expect(tc !== null).toBe(true);
      // Misuse: pull again without marking the first complete.
      expect(() => lib.nextTestCase(ctx, run)).toThrow(LibhegelError);
      lib.markComplete(ctx, tc, Status.VALID, null);
    } finally {
      lib.freeRun(run);
      lib.freeSettings(settings);
      lib.freeContext(ctx);
    }
  });

  it("drives spans and the collection protocol (lists)", () => {
    const ctx = lib.newContext();
    const settings = lib.newSettings();
    lib.setTestCases(settings, 20);
    lib.setVerbosity(settings, NativeVerbosity.QUIET);
    lib.setDatabase(ctx, settings, "");
    const run = lib.runStart(ctx, settings);
    const schema = Buffer.from(encode({ type: "integer", min_value: -100, max_value: 100 }));
    try {
      let rejectedOnce = false;
      for (;;) {
        const tc = lib.nextTestCase(ctx, run);
        if (tc === null) break;
        try {
          lib.startSpan(ctx, tc, Labels.LIST);
          const coll = lib.newCollection(ctx, tc, 0, 5);
          while (lib.collectionMore(ctx, tc, coll)) {
            lib.startSpan(ctx, tc, Labels.LIST_ELEMENT);
            decode(lib.generate(ctx, tc, schema));
            lib.stopSpan(ctx, tc, false);
            if (!rejectedOnce) {
              lib.collectionReject(ctx, tc, coll, "exercise reject");
              rejectedOnce = true;
            }
          }
          lib.stopSpan(ctx, tc, false);
          lib.markComplete(ctx, tc, Status.VALID, null);
        } catch (e) {
          if (e instanceof StopTestError) {
            lib.markComplete(ctx, tc, Status.OVERRUN, null);
          } else {
            throw e;
          }
        }
      }
      const result = lib.runResult(ctx, run);
      expect(lib.runStatus(result)).toBe(RunStatus.PASSED);
      expect(lib.runError(result)).toBeNull();
    } finally {
      lib.freeRun(run);
      lib.freeSettings(settings);
      lib.freeContext(ctx);
    }
  });
});
