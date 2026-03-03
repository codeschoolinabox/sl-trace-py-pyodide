/**
 * @file Main entry point for py-pyodide tracer.
 *
 * Adapts the tracer to @study-lenses/tracing TracerModule interface.
 * Signature: record(code, { meta, options })
 */

import { LimitExceededError, ParseError, RuntimeError } from '@study-lenses/tracing';
import type { MetaConfig, SourceLoc } from '@study-lenses/tracing';
import { loadPyodide } from 'pyodide';
import type { PyodideInterface } from 'pyodide';

type PyodideStep = {
  readonly step: number;
  readonly category: 'call' | 'return';
  readonly type: 'FunctionCall';
  readonly loc: {
    readonly start: { readonly line: number; readonly column: number };
    readonly end: { readonly line: number; readonly column: number };
  };
  readonly detail: {
    readonly name: string;
    readonly depth: number;
    readonly args?: readonly string[];
    readonly returnValue?: string;
  };
};

let pyodideInstance: PyodideInterface | null = null;

/**
 * Initialize Pyodide (lazy load, singleton pattern)
 */
async function initPyodide(): Promise<PyodideInterface> {
  if (!pyodideInstance) {
    pyodideInstance = await loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/',
    });

    // Install trace function
    await pyodideInstance.runPythonAsync(`
import sys
import json

trace_depth = 0
trace_steps = []

def trace_function(frame, event, arg):
    global trace_depth
    
    func_name = frame.f_code.co_name
    filename = frame.f_code.co_filename
    
    # ONLY trace user-defined functions (filename contains 'exec')
    if 'exec' not in filename:
        return trace_function
    
    # Skip special functions
    if func_name.startswith('_') or func_name in ['<module>', '<listcomp>']:
        return trace_function
    
    try:
        if event == 'call':
            args = []
            for var in frame.f_code.co_varnames[:frame.f_code.co_argcount]:
                val = frame.f_locals.get(var)
                args.append(str(val) if val is not None else 'None')
            
            trace_steps.append({
                'type': 'call',
                'name': func_name,
                'args': args,
                'depth': trace_depth,
                'line': frame.f_lineno
            })
            trace_depth += 1
            
        elif event == 'return':
            trace_depth -= 1
            ret_val = str(arg) if arg is not None else 'None'
            trace_steps.append({
                'type': 'return',
                'name': func_name,
                'value': ret_val,
                'depth': trace_depth,
                'line': frame.f_lineno
            })
    except Exception:
        pass
    
    return trace_function
`);
  }
  return pyodideInstance;
}

/**
 * Records execution trace for Python code.
 *
 * Uses Pyodide to execute Python in browser, sys.settrace() to capture
 * function calls/returns, and returns step-by-step trace data.
 *
 * @param code - Python source code to trace
 * @param config - Configuration object with meta (limits) and options
 * @returns Promise resolving to trace steps
 * @throws ParseError if code has syntax errors
 * @throws RuntimeError if code has runtime errors
 * @throws LimitExceededError if trace exceeds meta.max.steps
 */
async function record(
  code: string,
  config: { readonly meta: MetaConfig; readonly options: Record<string, unknown> },
): Promise<readonly PyodideStep[]> {
  const { meta } = config;

  // Detect environment: use subprocess in Node.js, Pyodide in browser
  const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);

  if (isNode) {
    // Node.js: use Python subprocess
    const recordViaSubprocess = await import('./subprocess.js');
    return recordViaSubprocess.default(code, meta);
  }

  // Browser: use Pyodide
  try {
    const pyodide = await initPyodide();

    // Reset trace state
    await pyodide.runPythonAsync(`
trace_depth = 0
trace_steps = []
sys.settrace(trace_function)
`);

    // Execute user code
    await pyodide.runPythonAsync(code);

    // Stop tracing
    await pyodide.runPythonAsync('sys.settrace(None)');

    // Get trace steps
    const rawStepsResult: unknown = await pyodide.runPythonAsync('json.dumps(trace_steps)');
    if (typeof rawStepsResult !== 'string') {
      throw new RuntimeError('Pyodide returned unexpected trace payload');
    }
    const rawSteps = rawStepsResult;
    type RawPyodideStep = Readonly<{
      readonly type: 'call' | 'return';
      readonly name: string;
      readonly args?: readonly string[];
      readonly value?: string;
      readonly depth: number;
      readonly line?: number | null;
    }>;

    const pythonSteps = JSON.parse(rawSteps) as readonly RawPyodideStep[];

    // Convert to Step[] format
    const steps: readonly PyodideStep[] = pythonSteps.map((step, index) => ({
      step: index + 1,
      category: step.type,
      type: 'FunctionCall',
      loc: {
        start: { line: step.line ?? 0, column: 0 },
        end: { line: step.line ?? 0, column: 0 },
      },
      detail: {
        name: step.name,
        depth: step.depth,
        ...(step.type === 'call'
          ? { args: step.args ?? [] }
          : { returnValue: step.value ?? 'None' }),
      },
    }));

    // Check max steps limit
    if (meta.max.steps && steps.length > meta.max.steps) {
      throw new LimitExceededError(
        `Trace has ${steps.length} steps, exceeds max ${meta.max.steps}`,
        'steps',
        steps.length,
      );
    }

    return steps;
  } catch (error) {
    // Handle Pyodide errors
    if (error instanceof LimitExceededError) {
      throw error;
    }

    if (error instanceof Error) {
      // Syntax errors
      if (error.message.includes('SyntaxError')) {
        throw new ParseError(error.message, extractParseErrorLoc(error.message));
      }
      // Runtime errors
      throw new RuntimeError(error.message);
    }

    throw new RuntimeError('Unknown error during Python execution');
  }
}

export default record;

function extractParseErrorLoc(message: string): SourceLoc {
  const lineMatch = /line\s+(\d+)/iu.exec(message);
  if (lineMatch) {
    const parsedLine = Number.parseInt(lineMatch[1] ?? '', 10);
    if (Number.isFinite(parsedLine)) {
      return { line: parsedLine, column: 0 };
    }
  }
  return { line: 0, column: 0 };
}
