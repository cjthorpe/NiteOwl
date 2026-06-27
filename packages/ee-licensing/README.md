# @niteowl/ee-licensing

**Enterprise Edition — commercial, source-available. NOT part of the open-source core.**

This package is the skeleton that establishes the `packages/ee-*` convention for
NiteOwl's commercial ("Enterprise Edition") code. It is licensed under the
[Business Source License 1.1](./LICENSE) (`BUSL-1.1`), **not** the Apache-2.0
licence that covers the open-source core.

## The rule

- **Commercial (`ee-*`) code may import core.**
- **Core code may NEVER import `ee-*`.**

This one-directional dependency is what keeps the free core always whole and the
commercial IP cleanly separable. It is enforced mechanically by
[`eslint.boundaries.cjs`](../../eslint.boundaries.cjs) — any `@niteowl/ee-*`
import from a core package or app fails CI.

## Where this really lives

Per the FUL-102 decision (Option C: public core + private commercial overlay),
production `ee-*` packages live in the **private overlay repo** and depend on the
published core packages. This skeleton stays in the public repo only to:

1. anchor the `packages/ee-*` naming + licence-header convention, and
2. give the import-boundary guard something concrete to test against.

See [`docs/open-core.md`](../../docs/open-core.md) for the open-core line and the
repo-split plan.
