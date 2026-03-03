/**
 * @file Node.js subprocess tracer (fallback for testing).
 *
 * Uses Python subprocess to execute code with tracing.
 * Only used in Node.js environments (for testing).
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LimitExceededError, ParseError, RuntimeError } from '@study-lenses/tracing';
import type { MetaConfig } from '@study-lenses/tracing';

type RawPyodideStep = {
  readonly type: 'call' | 'return';
  readonly name: string;
  readonly args?: readonly string[];
  readonly value?: string;
  readonly depth: number;
  readonly line?: number;
};

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

/**
 * Execute Python code via subprocess with tracing.
 */
async function recordViaSubprocess(
  code: string,
  meta: MetaConfig,
): Promise<readonly PyodideStep[]> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const tracerPath = path.join(__dirname, 'tracer.py');

  return new Promise<readonly PyodideStep[]>(function executor(resolve, reject) {
    const pythonBinary = process.env.PYTHON_BIN ?? '/usr/bin/python3';
    const python = spawn(pythonBinary, [tracerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    python.stdout.on('data', function handleStdout(chunk: Buffer) {
      stdout += chunk.toString('utf8');
    });

    python.stderr.on('data', function handleStderr(chunk: Buffer) {
      stderr += chunk.toString('utf8');
    });

    python.on('close', function handleClose(exitCode) {
      if (exitCode !== 0) {
        // Check for syntax errors
        if (stderr.includes('SyntaxError')) {
          reject(new ParseError(stderr, { line: 1, column: 0 }));
          return;
        }
        // Runtime errors
        reject(new RuntimeError(stderr || 'Python execution failed'));
        return;
      }

      try {
        const rawSteps: readonly RawPyodideStep[] = JSON.parse(stdout) as readonly RawPyodideStep[];

        // Convert to Step[] format
        const steps: readonly PyodideStep[] = rawSteps.map((step, index) => ({
          step: index + 1,
          category: step.type,
          type: 'FunctionCall' as const,
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
          reject(
            new LimitExceededError(
              `Trace has ${steps.length} steps, exceeds max ${meta.max.steps}`,
              'steps',
              steps.length,
            ),
          );
          return;
        }

        resolve(steps);
      } catch (parseError: unknown) {
        const message =
          parseError instanceof Error ? parseError.message : 'Failed to parse trace output';
        reject(new RuntimeError(message));
      }
    });

    python.on('error', function handleError(error) {
      reject(
        new RuntimeError(`Failed to spawn Python: ${error.message}. Ensure Python 3 is installed.`),
      );
    });

    // Send code to Python via stdin
    python.stdin.write(code);
    python.stdin.end();
  });
}

export default recordViaSubprocess;
