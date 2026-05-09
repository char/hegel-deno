RELEASE_TYPE: patch

This release makes `generators` reachable as a namespace from `@hegeldev/hegel`:

```typescript
// A
import * as hegel from "@hegeldev/hegel";
hegel.generators.integers()

// B, still works as before:
import * as gs from "@hegeldev/hegel/generators";
gs.integers()
```

We still recommend option B.

This release also removes a number of private APIs from the public exports of `@hegeldev/hegel`.
