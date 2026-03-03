/**
 * @file Tracer identifier for py-pyodide.
 *
 * Used as a cache-invalidation key by the API layer. Bump this value
 * whenever the options schema changes incompatibly (rare).
 */

const id = 'py:pyodide';

export default id;
