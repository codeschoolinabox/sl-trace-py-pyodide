/**
 * @file Tests for Python tracer record function.
 *
 * NOTE: These tests require a browser environment (Pyodide doesn't work in Node.js).
 * Run with: npm run test:browser (or use Vitest browser mode)
 *
 * For now, manual testing via test-browser.html or the Next.js test page.
 */

import { describe, it, expect } from 'vitest';

import record from '../index.js';

// Skip tests in Node.js environment
const isBrowser = globalThis.window !== undefined;
const describeIfBrowser = isBrowser ? describe : describe.skip;

describeIfBrowser('record()', () => {
  describe('basic execution', () => {
    it('should trace simple function call', async () => {
      const code = `
def add(a, b):
    return a + b

result = add(2, 3)
`;

      const steps = await record(code, {
        meta: {
          max: { steps: 1000, iterations: 100, callstack: 50, time: 5000 },
          timestamps: false,
        },
        options: {},
      });

      expect(steps.length).toBeGreaterThan(0);
      expect(steps[0]).toHaveProperty('step', 1);
      expect(steps[0]).toHaveProperty('category');
      expect(steps[0]).toHaveProperty('type', 'FunctionCall');
      expect(steps[0]).toHaveProperty('loc');
      expect(steps[0]).toHaveProperty('detail');
    });

    it('should track function arguments', async () => {
      const code = `
def greet(name):
    return f"Hello {name}"

greet("World")
`;

      const steps = await record(code, {
        meta: {
          max: { steps: 1000, iterations: 100, callstack: 50, time: 5000 },
          timestamps: false,
        },
        options: {},
      });

      const callStep = steps.find((s) => s.category === 'call');
      expect(callStep).toBeDefined();
      expect(callStep?.detail.args).toEqual(['World']);
    });

    it('should track return values', async () => {
      const code = `
def multiply(x, y):
    return x * y

multiply(3, 4)
`;

      const steps = await record(code, {
        meta: {
          max: { steps: 1000, iterations: 100, callstack: 50, time: 5000 },
          timestamps: false,
        },
        options: {},
      });

      const returnStep = steps.find((s) => s.category === 'return');
      expect(returnStep).toBeDefined();
      expect(returnStep?.detail.returnValue).toBe('12');
    });

    it('should track recursion depth', async () => {
      const code = `
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

factorial(3)
`;

      const steps = await record(code, {
        meta: {
          max: { steps: 1000, iterations: 100, callstack: 50, time: 5000 },
          timestamps: false,
        },
        options: {},
      });

      const depths = steps.map((s) => s.detail.depth);
      const maxDepth = Math.max(...depths);
      expect(maxDepth).toBeGreaterThan(0);
    });
  });

  describe('step format', () => {
    it('should have 1-indexed step numbers', async () => {
      const code = `
def test():
    return 42

test()
`;

      const steps = await record(code, {
        meta: {
          max: { steps: 1000, iterations: 100, callstack: 50, time: 5000 },
          timestamps: false,
        },
        options: {},
      });

      expect(steps[0].step).toBe(1);
      expect(steps[1].step).toBe(2);
    });

    it('should include line numbers in loc', async () => {
      const code = `
def example():
    return True

example()
`;

      const steps = await record(code, {
        meta: {
          max: { steps: 1000, iterations: 100, callstack: 50, time: 5000 },
          timestamps: false,
        },
        options: {},
      });

      for (const step of steps) {
        expect(step.loc.start.line).toBeGreaterThanOrEqual(0);
        expect(step.loc.start.column).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('limits', () => {
    it('should respect max steps limit', async () => {
      const code = `
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

fibonacci(10)
`;

      await expect(
        record(code, {
          meta: {
            max: { steps: 5, iterations: 100, callstack: 50, time: 5000 },
            timestamps: false,
          },
          options: {},
        }),
      ).rejects.toThrow('exceeds max 5');
    });
  });

  describe('error handling', () => {
    it('should throw ParseError for syntax errors', async () => {
      const code = `
def broken(
    return 42
`;

      await expect(
        record(code, {
          meta: {
            max: { steps: 1000, iterations: 100, callstack: 50, time: 5000 },
            timestamps: false,
          },
          options: {},
        }),
      ).rejects.toThrow();
    });

    it('should throw RuntimeError for runtime errors', async () => {
      const code = `
def divide(a, b):
    return a / b

divide(10, 0)
`;

      await expect(
        record(code, {
          meta: {
            max: { steps: 1000, iterations: 100, callstack: 50, time: 5000 },
            timestamps: false,
          },
          options: {},
        }),
      ).rejects.toThrow();
    });
  });
});
