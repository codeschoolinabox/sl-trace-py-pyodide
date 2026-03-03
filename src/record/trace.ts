// @ts-nocheck -- pre-existing tracer code from external developer (Kelley van Evert), not owned by this package
/**
 * @file JavaScript execution tracer using Babel instrumentation.
 *
 * Adapted from jsviz.klve.nl by Kelley van Evert.
 * Instruments JavaScript code and executes it to produce step-by-step traces.
 *
 * @see https://jsviz.klve.nl
 * @see https://github.com/kelleyvanevert/js_execution_stepping_through_meta_syntactic_transform
 */

import * as Babel from '@babel/standalone';
// eslint-disable-next-line boundaries/no-unknown -- file: dep resolves outside project root
import { LimitExceededError } from '@study-lenses/tracing';

import type { RawStep, SourceLocation, DescribedValue, HeapObject } from './types.js';

// Re-export Babel.types for plugin use
type BabelTypes = typeof Babel.types;
type BabelNode = Babel.types.Node;
type BabelExpression = Babel.types.Expression;
type BabelStatement = Babel.types.Statement;

/**
 * Traces JavaScript code execution and returns an array of steps.
 *
 * @param code - JavaScript source code to trace
 * @param limits - Execution limits (steps and time)
 * @returns Promise resolving to array of execution steps
 * @throws SyntaxError if code has parse errors
 * @throws Error if code has runtime errors
 * @throws LimitExceededError if execution exceeds step or time limits
 */
function trace(
  code: string,
  limits: { readonly maxSteps: number | null; readonly maxTime: number | null },
): readonly RawStep[] {
  const ns = '__V__';

  // Step 1: Transpile the code with instrumentation
  const transpiled = transpile(code, { ns });

  // Step 2: Execute and collect steps (limits enforced during execution)
  const steps = executeInstrumented(transpiled, ns, limits);

  return steps;
}

/**
 * Transpile code with the Babel plugin to add instrumentation.
 */
function transpile(code: string, config: { readonly ns: string }): string {
  const result = Babel.transform(code, {
    plugins: [[transpilerPlugin, config]],
  });

  if (!result?.code) {
    throw new Error('Babel transform failed to produce code');
  }

  return result.code;
}

/**
 * Execute instrumented code and collect execution steps.
 * Limits are enforced during execution via the report() callback.
 */
function executeInstrumented(
  transpiled: string,
  ns: string = '__V__',
  limits: { readonly maxSteps: number | null; readonly maxTime: number | null },
): readonly RawStep[] {
  // Create execution context with dynamic properties
  const context: Record<string, unknown> = {
    describe,
    console: {
      log(...arguments_: readonly unknown[]) {
        const nsObject = context[ns] as {
          _logs: (readonly DescribedValue[])[];
          readonly describe: typeof describe;
        };
        nsObject._logs.push(arguments_.map((item) => nsObject.describe(item)));
      },
    },
  };

  // Initialize the tracking namespace
  context[ns] = {
    _t0: Date.now(),
    _steps: [{ category: 'init', step: 0 }] as readonly RawStep[],
    _logs: [] as readonly (readonly DescribedValue[])[],
    cache: {} as Record<number, unknown>,
    describe,
    report(value: unknown, meta: Record<string, unknown>): unknown {
      const nsObject = context[ns] as {
        readonly _t0: number;
        readonly _steps: readonly RawStep[];
        readonly _logs: readonly (readonly DescribedValue[])[];
        readonly describe: typeof describe;
      };
      const dt = Date.now() - nsObject._t0;
      meta.dt = dt;

      // Enforce time limit (checked every step during execution)
      if (limits.maxTime !== null && dt > limits.maxTime) {
        throw new LimitExceededError(
          `Trace exceeded ${limits.maxTime}ms time limit at ${dt}ms`,
          'time',
          dt,
        );
      }

      // Enforce step limit (checked every step during execution)
      if (limits.maxSteps !== null && nsObject._steps.length >= limits.maxSteps) {
        throw new LimitExceededError(
          `Trace has ${nsObject._steps.length + 1} steps, exceeds max ${limits.maxSteps}`,
          'steps',
          nsObject._steps.length + 1,
        );
      }

      meta.step = nsObject._steps.push(meta as unknown as RawStep) - 1;
      meta.value = nsObject.describe(value);
      meta.logs = nsObject._logs;
      nsObject._logs = [];
      return value;
    },
  };

  // Execute the instrumented code
  const executorCode = `
    const console = this.console;
    const ${ns} = this.${ns};
    (function () {
      ${transpiled}
    }.call());
    return ${ns}._steps;
  `;

  // eslint-disable-next-line @typescript-eslint/no-implied-eval, sonarjs/code-eval -- tracer core: new Function() is intentional
  const executor = new Function(executorCode);
  const steps = executor.call(context) as readonly RawStep[];

  // Process steps to undescribe values
  for (const step of steps) {
    if ('value' in step && step.value !== undefined) {
      step.value = undescribe(step.value as DescribedValue);
    }
    if ('scopes' in step && step.scopes) {
      for (const scope of step.scopes) {
        undescribeScope(scope);
      }
    }
    if ('logs' in step && step.logs) {
      step.logs = step.logs.map((line) => line.map((item) => undescribe(item as DescribedValue)));
    }
  }

  function undescribeScope(scope: Record<string, unknown>): void {
    for (const key of Object.keys(scope)) {
      scope[key] = undescribe(scope[key] as DescribedValue);
    }
  }

  return steps;
}

/**
 * Serialize JavaScript values to a format that can be stored/transmitted.
 */
function describe(
  value: unknown,
  heap: readonly HeapObject[] = [],
  map: ReadonlyMap<object, number> = new Map(),
): DescribedValue {
  if (typeof value === 'string') {
    return [{ category: 'primitive', type: 'string', value }, heap];
  } else if (typeof value === 'boolean') {
    return [{ category: 'primitive', type: 'boolean', value }, heap];
  } else if (typeof value === 'number') {
    return [{ category: 'primitive', type: 'number', value }, heap];
  } else if (value === null) {
    return [{ category: 'primitive', type: 'null', value: null }, heap];
  } else if (value === undefined) {
    return [{ category: 'primitive', type: 'undefined', value: undefined }, heap];
  } else if (typeof value === 'symbol') {
    return [{ category: 'primitive', type: 'symbol', str: value.toString() }, heap];
  } else if (map.has(value as object)) {
    return [{ category: 'compound', at: map.get(value as object)! }, heap];
  } else {
    const at = heap.length;
    map.set(value as object, at);

    const object: HeapObject = { type: 'object', entries: [] };
    heap.push(object);

    if (typeof value === 'function') {
      object.type = 'function';
    } else if (typeof value === 'object' && 'then' in value && 'catch' in value) {
      object.type = 'promise';
    } else if (Array.isArray(value)) {
      object.type = 'array';
      object.length = value.length;
    } else if (typeof value === 'object') {
      object.cname = value.constructor.name;
    }

    for (const [key, v] of Object.entries(value as object)) {
      const [described] = describe(v, heap, map);
      object.entries.push([key, described]);
    }

    return [{ category: 'compound', at }, heap];
  }
}

/**
 * Deserialize values back to JavaScript objects.
 */
const FAKE_CONSTRUCTORS: Record<string, new () => object> = {};

function undescribe(described: DescribedValue, revived: readonly unknown[] = []): unknown {
  const [node, heap] = described;

  if (node.category === 'primitive') {
    if (node.type === 'symbol') {
      const m = /^Symbol\((.*)\)$/.exec(node.str ?? '');
      return Symbol(m ? m[1] : undefined);
    } else {
      return node.value;
    }
  } else if (revived[node.at] !== undefined) {
    return revived[node.at];
  }

  const object = heap[node.at];
  let value: unknown;

  if (object.type === 'function') {
    // eslint-disable-next-line arrow-body-style -- prettier conflict: empty arrow body, intentional fake function
    value = (() => () => {})(); // Avoid transpiler naming issues
  } else if (object.type === 'promise') {
    // eslint-disable-next-line arrow-body-style -- prettier conflict: empty arrow body, intentional never-resolving promise
    value = new Promise(() => {});
  } else if (object.type === 'array') {
    const array: readonly unknown[] = [];
    array.length = object.length ?? 0;
    value = array;
  } else if (object.cname) {
    // Create fake constructor for custom classes
    if (!FAKE_CONSTRUCTORS[object.cname]) {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, sonarjs/code-eval -- restoring serialized constructor names
      FAKE_CONSTRUCTORS[object.cname] = new Function(
        `return function ${object.cname}(){}`,
      )() as new () => object;
    }
    value = new FAKE_CONSTRUCTORS[object.cname]();
  } else {
    value = {};
  }

  revived[node.at] = value;

  for (const [key, entryNode] of object.entries) {
    (value as Record<string, unknown>)[key] = undescribe([entryNode, heap], revived);
  }

  return value;
}

/**
 * Babel plugin that instruments JavaScript code for tracing.
 */
function transpilerPlugin(
  babel: { readonly types: BabelTypes },
  { ns = '__V__' }: { readonly ns?: string } = {},
): { readonly name: string; readonly visitor: Record<string, unknown> } {
  const { types: t } = babel;

  // Convert JS data to Babel AST nodes
  function json(data: unknown): BabelExpression {
    if (typeof data === 'string') {
      return t.stringLiteral(data);
    } else if (typeof data === 'boolean') {
      return t.booleanLiteral(data);
    } else if (typeof data === 'number') {
      return t.numericLiteral(data);
    } else if (data === null) {
      return t.nullLiteral();
    } else if (data === undefined) {
      return t.identifier('undefined');
    } else if (Array.isArray(data)) {
      return t.arrayExpression(data.map((item) => json(item)));
    } else if (typeof data === 'object' && '$ast' in data) {
      return (data as { readonly $ast: BabelExpression }).$ast;
    } else {
      return t.objectExpression(
        Object.entries(data as object).map(([key, value]) =>
          t.objectProperty(t.stringLiteral(key), json(value)),
        ),
      );
    }
  }

  // Clone a node and remove location info
  function cloneAndDetach(node: BabelNode): BabelNode {
    // eslint-disable-next-line sonarjs/no-unused-vars -- loc destructured to omit it from spread
    const { loc: _loc, ...clone } = node as BabelNode & { readonly loc?: SourceLocation };
    for (const k in clone) {
      const value = (clone as Record<string, unknown>)[k];
      if (value !== null && typeof value === 'object' && 'type' in value) {
        (clone as Record<string, unknown>)[k] = cloneAndDetach(value as BabelNode);
      } else if (
        Array.isArray(value) &&
        value[0] &&
        typeof value[0] === 'object' &&
        'type' in value[0]
      ) {
        (clone as Record<string, unknown>)[k] = value.map((v) => cloneAndDetach(v as BabelNode));
      }
    }
    return clone as BabelNode;
  }

  // Mark LVal nodes as done to avoid double-processing
  function bailoutLval(node: BabelNode & { readonly _done?: boolean }): void {
    node._done = true;
    for (const k in node) {
      const value = (node as Record<string, unknown>)[k];
      // Bail out of LVals EXCEPT computed properties
      const isComputedProperty = k === 'property' && t.isMemberExpression(node) && node.computed;

      if (!isComputedProperty && value !== null && typeof value === 'object' && 'type' in value) {
        bailoutLval(value as BabelNode & { readonly _done?: boolean });
      }
    }
  }

  // Semantic action classification for each AST node type.
  const ACTION_MAP: Record<string, string> = {
    Identifier: 'read',
    MemberExpression: 'access',
    AssignmentExpression: 'assign',
    UpdateExpression: 'update',
    VariableDeclaration: 'declare',
    CallExpression: 'call',
    NewExpression: 'construct',
    BinaryExpression: 'compute',
    UnaryExpression: 'compute',
    LogicalExpression: 'compute',
    SequenceExpression: 'compute',
    ConditionalExpression: 'branch',
    IfStatement: 'branch',
    ForStatement: 'loop',
    WhileStatement: 'loop',
    TryStatement: 'protect',
    ExpressionStatement: 'evaluate',
    ArrowFunctionExpression: 'define',
    FunctionExpression: 'define',
    NumericLiteral: 'literal',
    StringLiteral: 'literal',
    BooleanLiteral: 'literal',
    ArrayExpression: 'literal',
    ObjectExpression: 'literal',
  };

  // Extract node-type-specific AST metadata for trace steps.
  // Uses node.type string comparison instead of t.is*() type guards
  // because @babel/standalone type defs are incomplete.
  // Always returns a detail object (never undefined).
  function extractDetail(node: BabelNode & { readonly type: string }): Record<string, unknown> {
    const n = node as unknown as Record<string, unknown>;
    const { type } = node;
    const action = ACTION_MAP[type] ?? 'unknown';

    if (type === 'BinaryExpression' || type === 'LogicalExpression') {
      return { action, operator: n['operator'] as string };
    }
    if (type === 'AssignmentExpression') {
      const left = n['left'] as Record<string, unknown>;
      return {
        action,
        operator: n['operator'] as string,
        target: left['type'] === 'Identifier' ? (left['name'] as string) : null,
      };
    }
    if (type === 'UnaryExpression') {
      return { action, operator: n['operator'] as string, prefix: n['prefix'] as boolean };
    }
    if (type === 'UpdateExpression') {
      const argument = n['argument'] as Record<string, unknown>;
      return {
        action,
        operator: n['operator'] as string,
        prefix: n['prefix'] as boolean,
        target: argument['type'] === 'Identifier' ? (argument['name'] as string) : null,
      };
    }
    if (type === 'VariableDeclaration') {
      const decls = n['declarations'] as readonly Record<string, unknown>[];
      const firstId = decls[0]?.['id'] as Record<string, unknown> | undefined;
      return {
        action,
        kind: n['kind'] as string,
        target: firstId?.['type'] === 'Identifier' ? (firstId['name'] as string) : null,
      };
    }
    if (type === 'MemberExpression') {
      const computed = n['computed'] as boolean;
      const property = n['property'] as Record<string, unknown>;
      const result: Record<string, unknown> = {
        action,
        computed,
        property:
          !computed && property['type'] === 'Identifier' ? (property['name'] as string) : null,
      };
      if (n['optional'] === true) {
        result['optional'] = true;
      }
      return result;
    }
    if (type === 'Identifier') {
      return { action, name: n['name'] as string };
    }
    if (type === 'CallExpression' || type === 'NewExpression') {
      const callee = n['callee'] as Record<string, unknown>;
      let calleeName: string | null = null;
      let isMethod = false;

      if (callee['type'] === 'Identifier') {
        calleeName = callee['name'] as string;
      } else if (callee['type'] === 'MemberExpression') {
        isMethod = true;
        const property = callee['property'] as Record<string, unknown>;
        if (property['type'] === 'Identifier') {
          calleeName = property['name'] as string;
        }
      }

      return {
        action,
        arity: (n['arguments'] as readonly unknown[]).length,
        callee: calleeName,
        method: isMethod,
      };
    }
    if (type === 'ArrowFunctionExpression') {
      const result: Record<string, unknown> = {
        action,
        arity: (n['params'] as readonly unknown[]).length,
        expressionBody: (n['body'] as Record<string, unknown>)['type'] !== 'BlockStatement',
      };
      if (n['async'] === true) {
        result['async'] = true;
      }
      return result;
    }
    if (type === 'FunctionExpression') {
      const id = n['id'] as { readonly name?: string } | null;
      const result: Record<string, unknown> = {
        action,
        name: id?.name ?? null,
        arity: (n['params'] as readonly unknown[]).length,
      };
      if (n['async'] === true) {
        result['async'] = true;
      }
      if (n['generator'] === true) {
        result['generator'] = true;
      }
      return result;
    }
    if (type === 'IfStatement' || type === 'ConditionalExpression') {
      return { action, hasAlternate: n['alternate'] != null };
    }
    if (type === 'ForStatement') {
      return {
        action,
        hasInit: n['init'] != null,
        hasTest: n['test'] != null,
        hasUpdate: n['update'] != null,
      };
    }
    if (type === 'TryStatement') {
      return {
        action,
        hasCatch: n['handler'] != null,
        hasFinally: n['finalizer'] != null,
      };
    }
    if (type === 'ArrayExpression') {
      return { action, elementCount: (n['elements'] as readonly unknown[]).length };
    }
    if (type === 'ObjectExpression') {
      return { action, propertyCount: (n['properties'] as readonly unknown[]).length };
    }
    // WhileStatement, ExpressionStatement, SequenceExpression, literals without extra fields
    return { action };
  }

  // Build metadata object for a step
  type ScopeWithBindings = {
    readonly bindings: Record<string, unknown>;
    readonly parent?: ScopeWithBindings;
    readonly _original?: boolean;
    readonly _definitelySkip?: boolean;
  };

  function meta(
    category: string,
    node: BabelNode & { readonly loc?: SourceLocation; readonly type: string },
    scope: ScopeWithBindings | undefined,
    time: 'before' | 'after',
  ): BabelExpression {
    const scopes: readonly Record<string, { readonly $ast: BabelExpression }>[] = [];

    let currentScope = scope;
    while (currentScope) {
      const scopeEntries = Object.keys(currentScope.bindings).map(
        (id) =>
          [
            id + (currentScope!._original ? '' : ' (!)'),
            {
              $ast: t.callExpression(t.identifier(`${ns}.describe`), [
                t.callExpression(
                  t.arrowFunctionExpression(
                    [],
                    t.blockStatement([
                      t.tryStatement(
                        t.blockStatement([t.returnStatement(t.identifier(id))]),
                        t.catchClause(null, t.blockStatement([])),
                      ),
                    ]),
                  ),
                  [],
                ),
              ]),
            },
          ] as readonly [string, { readonly $ast: BabelExpression }],
      );

      if (currentScope._original && !currentScope._definitelySkip) {
        scopes.push(Object.fromEntries(scopeEntries));
      }
      currentScope = currentScope.parent;
    }

    const detail = extractDetail(node);

    const metadata = {
      category,
      time,
      loc: node.loc,
      type: node.type,
      scopes,
      detail,
    };

    return json(metadata);
  }

  // Create a REPORT call expression
  function REPORT(
    value: BabelExpression | null,
    node: BabelNode & { readonly loc?: SourceLocation; readonly type: string },
    scope: ScopeWithBindings | undefined,
    time: 'before' | 'after',
  ): Babel.types.CallExpression {
    return t.callExpression(t.identifier(`${ns}.report`), [
      value ?? t.identifier('undefined'),
      meta(t.isExpression(node) ? 'expression' : 'statement', node, scope, time),
    ]);
  }

  let _cacheId = -1;
  function makeTemporaryVariable(): Babel.types.MemberExpression {
    _cacheId += 1;
    return t.memberExpression(t.identifier(`${ns}.cache`), t.numericLiteral(_cacheId), true);
  }

  // Visitor object with handlers for different node types
  const visitor = {
    Program(path: { readonly scope: ScopeWithBindings }) {
      path.scope._original = true;
    },

    Statement: {
      enter(path: {
        readonly node: BabelStatement & {
          readonly loc?: SourceLocation;
          readonly _done?: number;
          readonly _reportBefore?: boolean;
        };
        readonly scope: ScopeWithBindings;
        readonly parentPath: { readonly scope: ScopeWithBindings };
        readonly insertBefore: (node: BabelStatement) => void;
        readonly replaceWith: (node: BabelNode) => void;
        readonly getSibling: (key: number) => {
          readonly insertAfter: (node: BabelStatement) => void;
        };
        readonly key: number;
        readonly get: (key: string) => {
          readonly get: (key: string) =>
            | readonly { readonly scope: ScopeWithBindings }[]
            | {
                readonly get: (key: string) => {
                  readonly get: (key: string) => readonly { readonly scope: ScopeWithBindings }[];
                };
              };
        };
      }) {
        if (!path.node.loc || path.node._done) return;
        path.node._done = 1;

        // Skip function declarations (hoisted)
        if (t.isFunctionDeclaration(path.node)) return;

        // For/while scope is "internal"
        const scope =
          t.isForStatement(path.node) || t.isWhileStatement(path.node)
            ? path.parentPath.scope
            : path.scope;

        scope._original = true;

        if (!t.isBlockStatement(path.node)) {
          path.insertBefore(t.expressionStatement(REPORT(null, path.node, scope, 'before')));
        }

        if (t.isReturnStatement(path.node)) {
          const reportAfter = path.getSibling(path.key + 1);
          const returnNode = path.node;

          path.replaceWith(
            t.expressionStatement(
              t.assignmentExpression(
                '=',
                t.identifier(`${ns}.return`),
                returnNode.argument ?? t.identifier('undefined'),
              ),
            ),
          );

          reportAfter.insertAfter(t.returnStatement(t.identifier(`${ns}.return`)));
        } else if (t.isWhileStatement(path.node)) {
          const TMP = makeTemporaryVariable();
          const whileNode = path.node as Babel.types.WhileStatement & {
            readonly test: { readonly _reportBefore?: boolean };
          };
          whileNode.test._reportBefore = true;

          path.replaceWith(
            t.whileStatement(
              t.booleanLiteral(true),
              t.blockStatement([
                t.expressionStatement(t.assignmentExpression('=', TMP, whileNode.test)),
                t.ifStatement(t.unaryExpression('!', TMP), t.breakStatement()),
                whileNode.body,
              ]),
            ),
          );

          // Skip the if statement's scope
          const bodyPath = path.get('body') as {
            readonly get: (key: string) => readonly { readonly scope: ScopeWithBindings }[];
          };
          bodyPath.get('body')[1].scope._definitelySkip = true;
        } else if (t.isForStatement(path.node)) {
          const forNode = path.node as Babel.types.ForStatement & {
            readonly test: BabelExpression & { readonly _reportBefore?: boolean };
            readonly update: BabelExpression & { readonly _reportBefore?: boolean };
          };

          let initType: 'decl' | 'expr' | 'none';
          if (!forNode.init) {
            initType = 'none';
          } else if (t.isVariableDeclaration(forNode.init)) {
            initType = 'decl';
          } else {
            initType = 'expr';
          }

          let initAsStatement: BabelStatement;
          if (initType === 'decl') {
            initAsStatement = forNode.init as BabelStatement;
          } else if (initType === 'expr') {
            initAsStatement = t.expressionStatement(forNode.init as BabelExpression);
          } else {
            initAsStatement = t.expressionStatement(t.nullLiteral());
          }

          const TMP = makeTemporaryVariable();

          forNode.test._reportBefore = true;
          forNode.update._reportBefore = true;

          path.replaceWith(
            t.blockStatement([
              initAsStatement,
              t.whileStatement(
                t.booleanLiteral(true),
                t.blockStatement([
                  t.expressionStatement(t.assignmentExpression('=', TMP, forNode.test)),
                  t.ifStatement(t.unaryExpression('!', TMP), t.breakStatement()),
                  forNode.body,
                  t.expressionStatement(forNode.update),
                ]),
              ),
            ]),
          );

          // Skip the if statement's scope
          const bodyPath = path.get('body') as unknown as readonly {
            readonly get: (key: string) => {
              readonly get: (key: string) => readonly { readonly scope: ScopeWithBindings }[];
            };
          }[];
          bodyPath[1].get('body').get('body')[1].scope._definitelySkip = true;
        }
      },

      exit(path: {
        readonly node: BabelStatement & { readonly loc?: SourceLocation; readonly _done?: number };
        readonly scope: ScopeWithBindings;
        readonly insertAfter: (node: BabelStatement) => void;
      }) {
        if (!path.node.loc || path.node._done === 2) return;
        path.node._done = 2;

        if (t.isFunctionDeclaration(path.node)) return;

        if (!t.isBlockStatement(path.node)) {
          path.insertAfter(t.expressionStatement(REPORT(null, path.node, path.scope, 'after')));
        }
      },
    },

    ArrowFunctionExpression(path: {
      readonly node: Babel.types.ArrowFunctionExpression & {
        readonly loc?: SourceLocation;
        readonly _done?: boolean;
      };
      readonly parentPath: { readonly scope: ScopeWithBindings };
      readonly replaceWith: (node: BabelNode) => void;
    }) {
      if (!path.node.loc || path.node._done) return;
      path.node._done = true;

      const { scope } = path.parentPath;
      scope._original = true;

      path.replaceWith(
        REPORT(
          t.callExpression(
            t.memberExpression(
              t.functionExpression(
                null,
                path.node.params,
                t.isBlockStatement(path.node.body)
                  ? path.node.body
                  : t.blockStatement([t.returnStatement(path.node.body)]),
              ),
              t.identifier('bind'),
            ),
            [t.thisExpression()],
          ),
          path.node,
          scope,
          'after',
        ),
      );
    },

    FunctionExpression(path: {
      readonly node: Babel.types.FunctionExpression & {
        readonly loc?: SourceLocation;
        readonly _done?: boolean;
      };
      readonly parentPath: { readonly scope: ScopeWithBindings };
      readonly replaceWith: (node: BabelNode) => void;
    }) {
      if (!path.node.loc || path.node._done) return;
      path.node._done = true;

      const { scope } = path.parentPath;
      scope._original = true;

      path.replaceWith(REPORT(path.node, path.node, scope, 'after'));
    },

    Expression(path: {
      readonly node: BabelExpression & {
        readonly loc?: SourceLocation;
        readonly _done?: boolean;
        readonly _reportBefore?: boolean;
        readonly left?: BabelNode;
      };
      readonly scope: ScopeWithBindings;
      readonly replaceWith: (node: BabelNode) => void;
      readonly get: (key: string) => { readonly node?: BabelNode } | boolean;
    }) {
      if (!path.node.loc || path.node._done) return;
      path.node._done = true;

      path.scope._original = true;

      if (t.isAssignmentExpression(path.node)) {
        bailoutLval(path.node.left);
      }

      const maybeBeforeReporter = path.node._reportBefore
        ? REPORT(null, path.node, path.scope, 'before')
        : t.nullLiteral();

      if (t.isCallExpression(path.node)) {
        const callNode = path.node;
        const calleeResult = path.get('callee');
        const contextual =
          typeof calleeResult === 'object' &&
          'node' in calleeResult &&
          t.isMemberExpression(calleeResult.node);

        const temporaryContext = contextual ? makeTemporaryVariable() : t.identifier('undefined');
        const computed = contextual
          ? (callNode.callee as Babel.types.MemberExpression).computed
          : false;

        path.replaceWith(
          t.sequenceExpression([
            maybeBeforeReporter,
            REPORT(
              t.callExpression(
                t.memberExpression(
                  contextual
                    ? REPORT(
                        t.memberExpression(
                          t.assignmentExpression(
                            '=',
                            temporaryContext,
                            (callNode.callee as Babel.types.MemberExpression).object,
                          ),
                          (callNode.callee as Babel.types.MemberExpression).property,
                          computed,
                        ),
                        callNode.callee,
                        path.scope,
                        'after',
                      )
                    : callNode.callee,
                  t.identifier('call'),
                ),
                [temporaryContext, ...callNode.arguments],
              ),
              path.node,
              path.scope,
              'after',
            ),
          ]),
        );
      } else if (t.isUpdateExpression(path.node)) {
        const updateNode = path.node;
        if (updateNode.prefix) {
          const { argument, operator } = updateNode;
          const clonedArgument = cloneAndDetach(argument) as BabelExpression;
          path.replaceWith(
            t.sequenceExpression([
              maybeBeforeReporter,
              t.assignmentExpression(
                '=',
                clonedArgument as Babel.types.LVal,
                t.binaryExpression(operator[0] as '+' | '-', argument, t.numericLiteral(1)),
              ),
              REPORT(clonedArgument, path.node, path.scope, 'after'),
            ]),
          );
        } else {
          const TMP = makeTemporaryVariable();
          const { argument, operator } = updateNode;
          const clonedArgument = cloneAndDetach(argument) as BabelExpression;
          path.replaceWith(
            t.sequenceExpression([
              maybeBeforeReporter,
              t.assignmentExpression('=', TMP, argument),
              t.assignmentExpression(
                '=',
                clonedArgument as Babel.types.LVal,
                t.binaryExpression(operator[0] as '+' | '-', TMP, t.numericLiteral(1)),
              ),
              REPORT(TMP, path.node, path.scope, 'after'),
            ]),
          );
        }
      } else {
        // Normal case
        path.replaceWith(
          t.sequenceExpression([
            maybeBeforeReporter,
            REPORT(path.node, path.node, path.scope, 'after'),
          ]),
        );
      }
    },
  };

  return {
    name: 'stepperize',
    visitor,
  };
}

export default trace;
