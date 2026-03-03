# @study-lenses/trace-py-pyodide

[![npm version](https://img.shields.io/npm/v/@study-lenses/trace-py-pyodide.svg)](https://www.npmjs.com/package/@study-lenses/trace-py-pyodide)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

> Python execution tracer for `@study-lenses/tracing` — traces Python code via Pyodide + sys.settrace()

## Pedagogical Purpose

**Neutral infrastructure:** This package provides raw Python execution traces for
educational tool developers. It makes no pedagogical decisions — those belong in the
tools that consume it.

The trace data captures function calls and returns with arguments, return values, and
call depth. Educational tools decide which subset to show and how to present it.

## Who Is This For

**Primary — Educational tool developers:** Building Study Lenses, custom analysis tools,
or other learning environments that need Python execution traces.

**Secondary — CS instructors:** Using this package directly to build course-specific
debugging aids or step-through visualizations.

## Install

```bash
npm install @study-lenses/trace-py-pyodide
```

## Quick Start

```typescript
import trace from '@study-lenses/trace-py-pyodide';

const code = `
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

print(fibonacci(5))
`;

const steps = await trace(code);
console.log(steps);
// → [{ step: 1, category: 'call', type: 'FunctionCall', detail: { name: 'fibonacci', args: ['5'], depth: 0 }, ... }, ...]
```

## API Summary

`@study-lenses/trace-py-pyodide` pre-configures all four `@study-lenses/tracing` wrappers
with the py-pyodide tracer:

| Export                         | Description                                             |
| ------------------------------ | ------------------------------------------------------- |
| `trace(code, config?)`         | Positional args, throws on error. Default export.       |
| `tracify`                      | Chainable builder with tracer pre-set, throws on error. |
| `embody({ code, config? })`    | Keyed args, returns Result (no throw).                  |
| `embodify({ code?, config? })` | Immutable chainable builder, returns Result.            |

See [DOCS.md](./DOCS.md) for the full API reference.

## Design Principles

### What this package provides

- Function-level execution traces for Python code (calls and returns)
- Pyodide-based execution (Python in the browser via WebAssembly)
- sys.settrace() instrumentation (automatic, no code modification needed)
- Captures: function name, arguments, return values, call depth, line numbers
- The four standard `@study-lenses/tracing` wrappers, pre-bound to this tracer

### What this package does NOT do

- Make pedagogical decisions (what to show, how to explain)
- Persist or accumulate traces across calls
- Support languages other than Python
- Trace line-by-line execution (only function calls/returns)

## Architecture

```
code → Pyodide execution → sys.settrace() → function events → Step[]
```

The tracer uses Pyodide (CPython compiled to WebAssembly) to execute Python code
in the browser. Python's built-in `sys.settrace()` captures function call and return
events, which are converted to the `@study-lenses/tracing` Step[] format.

### Step Format

Each step includes:

```typescript
{
  step: number;           // 1-indexed
  category: 'call' | 'return';
  type: 'FunctionCall';
  loc: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  detail: {
    name: string;         // Function name
    depth: number;        // Call stack depth
    args?: string[];      // Arguments (for 'call' steps)
    returnValue?: string; // Return value (for 'return' steps)
  };
}
```

## Browser-Only

**Important:** This package works in both browser and Node.js environments:

- **Browser:** Uses Pyodide (Python compiled to WebAssembly)
- **Node.js:** Uses Python subprocess (requires Python 3 installed)

The tracer automatically detects the environment and uses the appropriate method.

**For Node.js testing:** Ensure Python 3 is installed and available as `python3` in your PATH.

## Examples

### Basic Function Call

```typescript
import trace from '@study-lenses/trace-py-pyodide';

const steps = await trace(`
def greet(name):
    return f"Hello, {name}!"

greet("World")
`);

// Returns 2 steps: call + return
```

### Recursive Function

```typescript
const steps = await trace(`
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

factorial(5)
`);

// Returns 10 steps: 5 calls + 5 returns
```

### With Config Options

```typescript
import { tracify } from '@study-lenses/trace-py-pyodide';

const steps = await tracify
  .code(
    `
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

fibonacci(10)
`,
  )
  .meta({ max: { steps: 50 } }) // Limit to 50 steps
  .record();
```

## Limitations

- **Function-level only:** Traces function calls/returns, not line-by-line execution
- **Performance (browser):** Pyodide initialization takes 3-10 seconds on first load
- **Size (browser):** Pyodide is ~10MB (cached after first load)
- **Node.js requirement:** Requires Python 3 installed for Node.js/testing mode

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [DEV.md](./DEV.md).

## License

MIT © 2025 Fahed Daibes & Evan Cole
