export { expect, fn } from "jsr:@std/expect@1";
export { afterEach, beforeEach, describe, it, it as test } from "jsr:@std/testing@1/bdd";
export { stub } from "jsr:@std/testing@1/mock";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export function expectTypeOf<T>(_value: T) {
  return {
    toEqualTypeOf<U>(..._mismatch: Equal<T, U> extends true ? [] : [never]) {},
    not: {
      toEqualTypeOf<U>(..._mismatch: Equal<T, U> extends false ? [] : [never]) {},
    },
  };
}
