/**
 * @file Post-execution filtering for trace steps.
 *
 * Filters steps based on configuration, removing unwanted node types,
 * timing phases, and data fields.
 */

import { AST_TO_CONFIG } from './ast-map.js';
import type { RawStep, JsKlveOptions, JsKlveNameConfig, JsKlveStep } from './types.js';

/**
 * Fully resolved node config (all fields required, no undefined).
 */
type ResolvedNodeConfig = {
  readonly declarations: { readonly variable: boolean };
  readonly loops: { readonly for: boolean; readonly while: boolean };
  readonly conditionals: { readonly if: boolean; readonly ternary: boolean };
  readonly blocks: { readonly try: boolean; readonly expressionStatement: boolean };
  readonly calls: { readonly call: boolean; readonly new: boolean };
  readonly access: { readonly member: boolean; readonly identifier: boolean };
  readonly operators: {
    readonly binary: boolean;
    readonly unary: boolean;
    readonly logical: boolean;
    readonly assignment: boolean;
    readonly update: boolean;
    readonly sequence: boolean;
  };
  readonly literals: {
    readonly numeric: boolean;
    readonly string: boolean;
    readonly boolean: boolean;
    readonly array: boolean;
    readonly object: boolean;
  };
  readonly functions: { readonly arrow: boolean; readonly expression: boolean };
};

/**
 * Resolved name filter config.
 * mode: 'include' (whitelist), 'exclude' (blacklist), or 'none' (no filtering).
 */
type ResolvedNameConfig = {
  readonly mode: 'include' | 'exclude' | 'none';
  readonly names: ReadonlySet<string>;
};

/**
 * Fully resolved filter config (all fields required, no undefined).
 */
type ResolvedFilterConfig = {
  readonly nodes: ResolvedNodeConfig;
  readonly names: ResolvedNameConfig;
  readonly timing: { readonly before: boolean; readonly after: boolean };
  readonly data: {
    readonly scopes: boolean;
    readonly value: boolean;
    readonly logs: boolean;
    readonly dt: boolean;
    readonly loc: boolean;
  };
};

/**
 * Default filter configuration (all enabled).
 */
const DEFAULT_FILTER_CONFIG: ResolvedFilterConfig = {
  nodes: {
    declarations: { variable: true },
    loops: { for: true, while: true },
    conditionals: { if: true, ternary: true },
    blocks: { try: true, expressionStatement: true },
    calls: { call: true, new: true },
    access: { member: true, identifier: true },
    operators: {
      binary: true,
      unary: true,
      logical: true,
      assignment: true,
      update: true,
      sequence: true,
    },
    literals: { numeric: true, string: true, boolean: true, array: true, object: true },
    functions: { arrow: true, expression: true },
  },
  names: { mode: 'none' as const, names: new Set<string>() },
  timing: { before: true, after: true },
  data: { scopes: true, value: true, logs: true, dt: true, loc: true },
};

/**
 * Fills missing config values with defaults.
 */
function fillConfig(options: JsKlveOptions): ResolvedFilterConfig {
  const d = DEFAULT_FILTER_CONFIG;

  return {
    nodes: fillNodes(options),
    names: fillNameConfig(options.filter?.names),
    timing: {
      before: options.filter?.timing?.before ?? d.timing.before,
      after: options.filter?.timing?.after ?? d.timing.after,
    },
    data: {
      scopes: options.filter?.data?.scopes ?? d.data.scopes,
      value: options.filter?.data?.value ?? d.data.value,
      logs: options.filter?.data?.logs ?? d.data.logs,
      dt: options.filter?.data?.dt ?? d.data.dt,
      loc: options.filter?.data?.loc ?? d.data.loc,
    },
  };
}

/**
 * Fills missing node type toggle values with defaults.
 */
function fillNodes(options: JsKlveOptions): ResolvedNodeConfig {
  const d = DEFAULT_FILTER_CONFIG.nodes;

  return {
    declarations: {
      variable: options.declarations?.variable ?? d.declarations.variable,
    },
    loops: {
      for: options.loops?.for ?? d.loops.for,
      while: options.loops?.while ?? d.loops.while,
    },
    conditionals: {
      if: options.conditionals?.if ?? d.conditionals.if,
      ternary: options.conditionals?.ternary ?? d.conditionals.ternary,
    },
    blocks: {
      try: options.blocks?.try ?? d.blocks.try,
      expressionStatement: options.blocks?.expressionStatement ?? d.blocks.expressionStatement,
    },
    calls: {
      call: options.calls?.call ?? d.calls.call,
      new: options.calls?.new ?? d.calls.new,
    },
    access: {
      member: options.access?.member ?? d.access.member,
      identifier: options.access?.identifier ?? d.access.identifier,
    },
    operators: {
      binary: options.operators?.binary ?? d.operators.binary,
      unary: options.operators?.unary ?? d.operators.unary,
      logical: options.operators?.logical ?? d.operators.logical,
      assignment: options.operators?.assignment ?? d.operators.assignment,
      update: options.operators?.update ?? d.operators.update,
      sequence: options.operators?.sequence ?? d.operators.sequence,
    },
    literals: {
      numeric: options.literals?.numeric ?? d.literals.numeric,
      string: options.literals?.string ?? d.literals.string,
      boolean: options.literals?.boolean ?? d.literals.boolean,
      array: options.literals?.array ?? d.literals.array,
      object: options.literals?.object ?? d.literals.object,
    },
    functions: {
      arrow: options.functions?.arrow ?? d.functions.arrow,
      expression: options.functions?.expression ?? d.functions.expression,
    },
  };
}

/**
 * Resolves name filter config to a mode + set.
 * include takes precedence if both provided.
 */
function fillNameConfig(config?: JsKlveNameConfig): ResolvedNameConfig {
  if (!config) return { mode: 'none', names: new Set() };

  if (config.include && config.include.length > 0) {
    return { mode: 'include', names: new Set(config.include) };
  }
  if (config.exclude && config.exclude.length > 0) {
    return { mode: 'exclude', names: new Set(config.exclude) };
  }

  return { mode: 'none', names: new Set() };
}

/**
 * Extracts name-like strings from a step's detail fields.
 * Returns empty array if step has no detail or no name fields.
 */
function extractStepNames(step: RawStep): readonly string[] {
  if (!step.detail) return [];
  const result: string[] = [];
  const d = step.detail;
  if (typeof d.name === 'string') result.push(d.name);
  if (typeof d.target === 'string') result.push(d.target);
  if (typeof d.callee === 'string') result.push(d.callee);
  if (typeof d.property === 'string') result.push(d.property);
  return result;
}

/**
 * Tests whether a step passes the name filter.
 * Init steps and nameless steps always pass.
 */
function passesNameFilter(step: RawStep, nameConfig: ResolvedNameConfig): boolean {
  if (nameConfig.mode === 'none') return true;
  if (step.category === 'init') return true;

  const names = extractStepNames(step);
  if (names.length === 0) return true;

  if (nameConfig.mode === 'include') {
    return names.some((n) => nameConfig.names.has(n));
  }
  // exclude mode
  return !names.some((n) => nameConfig.names.has(n));
}

/**
 * Builds a lookup table from filled node config.
 * Returns { ASTNodeType: boolean } for O(1) filtering.
 */
function buildNodeLookup(nodes: ResolvedNodeConfig): Record<string, boolean> {
  const result: Record<string, boolean> = {};

  // Flatten nested config to { configPath: boolean }
  const flatConfig: Record<string, boolean> = {
    'declarations.variable': nodes.declarations.variable,
    'loops.for': nodes.loops.for,
    'loops.while': nodes.loops.while,
    'conditionals.if': nodes.conditionals.if,
    'conditionals.ternary': nodes.conditionals.ternary,
    'blocks.try': nodes.blocks.try,
    'blocks.expressionStatement': nodes.blocks.expressionStatement,
    'calls.call': nodes.calls.call,
    'calls.new': nodes.calls.new,
    'access.member': nodes.access.member,
    'access.identifier': nodes.access.identifier,
    'operators.binary': nodes.operators.binary,
    'operators.unary': nodes.operators.unary,
    'operators.logical': nodes.operators.logical,
    'operators.assignment': nodes.operators.assignment,
    'operators.update': nodes.operators.update,
    'operators.sequence': nodes.operators.sequence,
    'literals.numeric': nodes.literals.numeric,
    'literals.string': nodes.literals.string,
    'literals.boolean': nodes.literals.boolean,
    'literals.array': nodes.literals.array,
    'literals.object': nodes.literals.object,
    'functions.arrow': nodes.functions.arrow,
    'functions.expression': nodes.functions.expression,
  };

  // Invert: for each AST type, lookup its config value
  for (const [astType, configPath] of Object.entries(AST_TO_CONFIG)) {
    result[astType] = flatConfig[configPath] ?? true;
  }

  return result;
}

/**
 * Strips data fields from a step based on config.
 */
function stripData(step: RawStep, dataConfig: ResolvedFilterConfig['data']): JsKlveStep {
  const result: JsKlveStep = {
    step: step.step,
    category: step.category,
  };

  if (step.type !== undefined) {
    (result as { type?: string }).type = step.type;
  }

  if (step.time !== undefined) {
    (result as { time?: string }).time = step.time;
  }

  if (dataConfig.loc && step.loc !== undefined) {
    (result as { loc?: typeof step.loc }).loc = step.loc;
  }

  if (dataConfig.dt && step.dt !== undefined) {
    (result as { dt?: number }).dt = step.dt;
  }

  if (dataConfig.scopes && step.scopes !== undefined) {
    (result as { scopes?: readonly Record<string, unknown>[] }).scopes = step.scopes;
  }

  if (dataConfig.value && step.value !== undefined) {
    (result as { value?: unknown }).value = step.value;
  }

  if (dataConfig.logs && step.logs !== undefined) {
    (result as { logs?: readonly (readonly unknown[])[] }).logs = step.logs;
  }

  if (step.detail !== undefined) {
    (result as { detail?: typeof step.detail }).detail = step.detail;
  }

  return result;
}

/**
 * Filters steps based on configuration.
 *
 * @param steps - Raw steps from tracer
 * @param config - Filter configuration (partial, defaults applied)
 * @returns Filtered and stripped steps
 */
function filterSteps(steps: readonly RawStep[], config: JsKlveOptions = {}): readonly JsKlveStep[] {
  const filled = fillConfig(config);
  const nodeLookup = buildNodeLookup(filled.nodes);

  function passesNodeAndTimingFilters(step: RawStep): boolean {
    if (step.category === 'init') return true;
    if (step.time && !filled.timing[step.time]) return false;
    if (step.type && nodeLookup[step.type] === false) return false;
    return true;
  }

  return steps
    .filter((step) => passesNodeAndTimingFilters(step))
    .filter((step) => passesNameFilter(step, filled.names))
    .map((step) => stripData(step, filled.data));
}

export default filterSteps;
// eslint-disable-next-line import/no-named-export
export { fillConfig, fillNameConfig, buildNodeLookup, extractStepNames, DEFAULT_FILTER_CONFIG };
