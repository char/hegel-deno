RELEASE_TYPE: minor

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
