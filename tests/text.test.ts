import { describe, test, expect } from "./_deps.ts";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

describe("gs.text()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.text().asBasic()).not.toBeNull();
  });

  test("generates strings within size bounds", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.text({ minSize: 0, maxSize: 20 }));
        expect(typeof v).toBe("string");
        expect([...v].length).toBeLessThanOrEqual(20);
      },
      { testCases: 20 },
    ));

  test("generates strings with minSize", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.text({ minSize: 5, maxSize: 20 }));
        expect([...v].length).toBeGreaterThanOrEqual(5);
      },
      { testCases: 20 },
    ));

  test("generates strings without maxSize", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.text());
        expect(typeof v).toBe("string");
      },
      { testCases: 10 },
    ));
});

describe("gs.characters()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.characters().asBasic()).not.toBeNull();
  });

  test("generates single characters", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.characters());
        expect([...v].length).toBe(1);
      },
      { testCases: 20 },
    ));

  test("generates characters without options", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.characters());
        expect([...v].length).toBe(1);
        expect(typeof v).toBe("string");
      },
      { testCases: 20 },
    ));
});
