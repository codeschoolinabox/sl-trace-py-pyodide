# record — Architecture & Decisions

## Responsibility

This module owns the boundary between `@study-lenses/tracing`'s `RecordFunction`
contract and the klve engine. `index.ts` is the adapter; the engine files are external.

## Why a folder?

Grouping engine code, adapter, types, and tests under `record/` keeps klve-specific
implementation details out of `src/`. New engine files belong here, not in `src/`.

## What we own vs what we don't

| File                    | Owned by                                 |
| ----------------------- | ---------------------------------------- |
| `index.ts`              | This package — adapter + error mapping   |
| `trace.ts`              | Kelley van Evert (external, do not edit) |
| `filter-steps.ts`       | Kelley van Evert (external, do not edit) |
| `ast-map.ts`            | Kelley van Evert (external, do not edit) |
| `types.ts`              | Kelley van Evert (external, do not edit) |
| `babel-standalone.d.ts` | Type shim, do not edit                   |

External files are excluded from ESLint and TypeScript strict checking.

## Error mapping

The klve engine throws its own error types. `index.ts` maps them to the standard
`@study-lenses/tracing` types before re-throwing:

- Babel `SyntaxError` with `.loc` → `ParseError`
- Runtime errors → `RuntimeError`
- Engine limit signals → `LimitExceededError`

## Step numbering

The klve engine produces 0-indexed steps internally. `index.ts` renumbers them to
1-indexed before returning — consumers expect step 1, not step 0.
