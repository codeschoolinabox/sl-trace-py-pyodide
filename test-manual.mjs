/**
 * Quick test for Python tracer
 */

import trace from './dist/index.js';

const code = `
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

print('Result:', fibonacci(3))
`;

console.log('Testing Python tracer...\n');

try {
  const steps = await trace(code);
  console.log(`✓ Success! Got ${steps.length} steps\n`);
  console.log('First 5 steps:');
  console.log(JSON.stringify(steps.slice(0, 5), null, 2));
} catch (error) {
  console.error('✗ Error:', error.message);
}
