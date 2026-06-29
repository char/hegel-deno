RELEASE_TYPE: patch

This patch adds the `reportMultipleFailures` setting. When enabled, a run keeps
generating after the first failure to surface additional *distinct* failures
(each with a different origin); when disabled, the run stops after the first
failing example. It defaults to `false`.

```ts
hegel.test(fn, { reportMultipleFailures: true });
```
