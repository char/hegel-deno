/**
 * Hegel property-based testing library for TypeScript.
 *
 * The root entry point exposes the test runner, settings, and core types.
 * Generators live under `hegel/generators`.
 *
 * @packageDocumentation
 */

export { TestCase, Collection, Labels, StopTestError, AssumeError } from "./testCase.js";
export type { GeneratorLike, DataSource } from "./testCase.js";
export {
  test,
  testAsync,
  Verbosity,
  HealthCheck,
  Database,
  defaultSettings,
  ServerDataSource,
} from "./runner.js";
export type { Settings, TestCaseResult, TestLocation } from "./runner.js";
export type { Packet } from "./protocol.js";
export { Connection, Stream } from "./connection.js";
export { HegelSession, HEGEL_SERVER_VERSION } from "./session.js";
