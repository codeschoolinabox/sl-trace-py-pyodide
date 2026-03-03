# src/

Source module map for `@study-lenses/trace-js-klve`.

## Module Overview

```text
src/
  index.ts            ← Assembly point. Wire-up only — do not add logic here.
  id.ts               ← Tracer ID string ('js:klve')
  langs.ts            ← Supported extensions (['js', 'mjs', 'cjs'])
  options-schema.ts   ← Re-exports options.schema.json (thin wrapper)
  options.schema.json ← JSON Schema for JsKlveOptions
  verify-options/     ← Semantic validation (mutual exclusivity constraints)
  record/             ← Tracer core. See record/README.md.
  utils/              ← Deep object utilities. See utils/README.md.
```

## What To Edit

| File                      | When to touch it                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `record/index.ts`         | Changing the tracing pipeline or filter behaviour                                  |
| `verify-options/index.ts` | Adding new cross-field constraints to options                                      |
| `options.schema.json`     | Changing the options structure                                                     |
| `id.ts`                   | Bumping the tracer cache key (rare — only when options shape changes incompatibly) |
| `langs.ts`                | Adding/removing supported file extensions                                          |

## What NOT To Touch

- `index.ts` — pure assembly; if you find yourself adding logic here, it belongs elsewhere
- `record/tracer.ts`, `record/filter-steps.ts`, `record/ast-map.ts`, `record/types.ts`
  — pre-existing external code (see `record/README.md`)
- `options-schema.ts` — thin re-export, no logic

## Dependency DAG

```text
entry (index.ts)
  → record/          (record/index.ts)
  → verify-options/  (verify-options/index.ts)
  → core             (id, langs, options-schema, options.schema.json)
  → utils/           (deep-freeze, deep-clone, ...)
```
