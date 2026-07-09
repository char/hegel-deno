RELEASE_TYPE: minor

This release changes the default match mode of `fromRegex` from "contains a
match" to "fullmatch": generated strings must now match the pattern in their
entirety, rather than merely containing a match somewhere.

```ts
gs.fromRegex("[0-9]{3}");
// before: any string containing three digits, e.g. "ab123cd"
// now:    exactly three digits, e.g. "123"

gs.fromRegex("[0-9]{3}", { fullmatch: false }); // previous behavior
```
