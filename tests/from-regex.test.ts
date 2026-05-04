import { describe, test, expect } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

describe("gs.fromRegex()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.fromRegex("[0-9]+").asBasic()).not.toBeNull();
  });

  test("generates strings matching the pattern", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.fromRegex("[0-9]{3}", { fullmatch: true }));
        expect(v).toMatch(/^[0-9]{3}$/);
      },
      { testCases: 50 },
    ));

  test("fullmatch=false allows partial matches", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.fromRegex("[a-z]+", { fullmatch: false }));
        expect(typeof v).toBe("string");
        expect(v).toMatch(/[a-z]+/);
      },
      { testCases: 20 },
    ));
});
