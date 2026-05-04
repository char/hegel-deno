# Changelog

## 0.2.0 - 2026-05-04

This release changes `hegel.test` to execute immediately when called, instead of returning a callable which must be called to run the property-based test.

For example, here's how to migrate `vitest` tests to this release:

```typescript
// before
test("my test", hegel.test(...))

// after
test("my test", () => hegel.test(...))
```

This release also adds `hegel.testAsync`, for use with async tests:

```typescript
test("my async test", () =>
  hegel.testAsync(async (tc) => {
    const id = tc.draw(gs.integers({ minValue: 1 }));
    await fetchUser(id);
  }),
);
```

## 0.1.5 - 2026-04-30

Internal refactor.

## 0.1.4 - 2026-04-29

Internal refactor of `oneOf`.

## 0.1.3 - 2026-04-28

Bump our pinned `hegel-core` version from `0.4.0` to [`0.4.14`](https://github.com/hegeldev/hegel-core/releases/tag/v0.4.14).

## 0.1.2 - 2026-04-25

Loosen the type of `sampledFrom` and `text({categories: ...})` to accept `readonly` arrays.

## 0.1.1 - 2026-04-22

Internal refactor in preparation for release.

## 0.1.0 - 2026-04-21

Initial release!
