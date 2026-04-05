import type { ActionManifestInfo, ManifestActionSource } from "./manifest-types";

// ── Manifest Extraction ─────────────────────────────────────────────
//
// Build-time static analysis to extract action metadata from source
// code.  Scans the module graph for `defineAction()` calls and
// extracts `uuid`, `info`, and component presence (`key`, `dial`,
// `touchStrip`) from the object literal argument.
//
// This powers code-first manifest generation: action metadata lives
// exclusively in `defineAction()` calls — the bundler plugin's
// `manifest` option only contains plugin-level info.
//
// How it works:
//
//   1. The bundler plugin's `moduleParsed` hook is called for every
//      module in the dependency graph (after all transforms).
//   2. For each module, we check if the code contains "defineAction"
//      (quick string check to skip unrelated modules).
//   3. We walk the ESTree AST to find CallExpression nodes where the
//      callee is `defineAction`.
//   4. From each call's ObjectExpression argument, we extract:
//      - `uuid`: string literal (required)
//      - `key`, `dial`, `touchStrip`: property presence (for Controller derivation)
//      - `info`: static object literal (recursive evaluation)
//      - `info.disabled`: when true, the action is skipped
//
// Limitations:
//
//   - Only detects calls using the exact name `defineAction`.
//     Aliased imports (e.g. `import { defineAction as da }`) are not
//     detected.  This covers 99% of usage patterns.
//   - The `info` object must be a static literal (no variable
//     references, spread operators, or computed properties).
//     Non-static values are silently skipped with a `null` info.
//   - Template literals with expressions are not evaluated.

// ── ESTree Node Types (minimal) ─────────────────────────────────────
//
// Subset of ESTree spec used for AST walking.  We use Record<string, any>
// for flexibility since AST shapes vary between parsers (acorn, esbuild,
// oxc).  The only requirement is that nodes have a `type` property.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ASTNode = Record<string, any>;

// ── Extracted Action ────────────────────────────────────────────────

export interface ExtractedAction {
  uuid: string;
  hasKey: boolean;
  hasDial: boolean;
  hasTouchStrip: boolean;
  info: ActionManifestInfo | null;
}

// ── AST Walking ─────────────────────────────────────────────────────
//
// Simple recursive depth-first walker.  Visits every node in the tree
// and calls the visitor callback.  Skips position metadata keys
// (`start`, `end`, `loc`, `range`) for performance.

const SKIP_KEYS = new Set(["type", "start", "end", "loc", "range"]);

function walkAST(node: ASTNode | null | undefined, visitor: (node: ASTNode) => void): void {
  if (!node || typeof node !== "object" || !node.type) return;

  visitor(node);

  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const child: unknown = node[key];

    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && (item as ASTNode).type) {
          walkAST(item as ASTNode, visitor);
        }
      }
    } else if (child && typeof child === "object" && (child as ASTNode).type) {
      walkAST(child as ASTNode, visitor);
    }
  }
}

// ── Static Value Evaluation ─────────────────────────────────────────
//
// Recursively evaluates an AST node to a static JavaScript value.
// Returns the sentinel UNEVALUABLE for non-static expressions
// (variable references, function calls, spread elements, etc.).
//
// Supported node types:
//   - Literal           → string, number, boolean, null, regex
//   - ObjectExpression   → { key: value } (no spread, no computed keys)
//   - ArrayExpression    → [a, b, c] (no spread)
//   - UnaryExpression    → -1, !true
//   - TemplateLiteral    → `hello` (no expressions)

const UNEVALUABLE = Symbol("unevaluable");

function evaluateStatic(node: ASTNode): unknown {
  if (!node) return UNEVALUABLE;

  switch (node.type as string) {
    case "Literal":
      return node.value;

    case "ObjectExpression": {
      const obj: Record<string, unknown> = {};
      for (const prop of (node.properties ?? []) as ASTNode[]) {
        if (prop.type === "SpreadElement") return UNEVALUABLE;
        if (prop.type !== "Property") continue;
        if (prop.computed) return UNEVALUABLE;

        const key: unknown = prop.key.type === "Identifier" ? prop.key.name : prop.key.value;
        if (typeof key !== "string") return UNEVALUABLE;

        const value = evaluateStatic(prop.value as ASTNode);
        if (value === UNEVALUABLE) return UNEVALUABLE;

        obj[key] = value;
      }
      return obj;
    }

    case "ArrayExpression": {
      const arr: unknown[] = [];
      for (const el of (node.elements ?? []) as (ASTNode | null)[]) {
        if (!el) {
          arr.push(null);
          continue;
        }
        if (el.type === "SpreadElement") return UNEVALUABLE;
        const value = evaluateStatic(el);
        if (value === UNEVALUABLE) return UNEVALUABLE;
        arr.push(value);
      }
      return arr;
    }

    case "UnaryExpression":
      // Handle negative numbers: -1, -0.5
      if (
        node.operator === "-" &&
        node.argument?.type === "Literal" &&
        typeof node.argument.value === "number"
      ) {
        return -(node.argument.value as number);
      }
      // Handle boolean negation: !true, !false, !0, !1
      if (node.operator === "!") {
        const arg = evaluateStatic(node.argument as ASTNode);
        if (arg === UNEVALUABLE) return UNEVALUABLE;
        return !arg;
      }
      return UNEVALUABLE;

    case "TemplateLiteral":
      // Only handle template literals with no expressions: `hello`
      if (
        (node.expressions as unknown[])?.length === 0 &&
        (node.quasis as ASTNode[])?.length === 1
      ) {
        return (node.quasis as ASTNode[])[0]?.value?.cooked;
      }
      return UNEVALUABLE;

    default:
      return UNEVALUABLE;
  }
}

// ── defineAction() Detection ────────────────────────────────────────

function isDefineActionCall(node: ASTNode): boolean {
  if (node.type !== "CallExpression") return false;
  const callee = node.callee as ASTNode;
  return callee?.type === "Identifier" && callee.name === "defineAction";
}

// ── defineAction() Property Extraction ──────────────────────────────
//
// From the first argument (ObjectExpression), we extract:
//
//   uuid:       string literal → action identifier
//   key:        property presence → Keypad controller
//   dial:       property presence → Encoder controller
//   touchStrip: property presence → Encoder controller
//   info:       static object → ActionManifestInfo
//
// The info object is validated for minimum required fields (name, icon).
// If info.disabled is true, the action is still extracted but marked
// so the bundler can skip it during manifest generation.

function extractFromDefineAction(node: ASTNode): ExtractedAction | null {
  const args = node.arguments as ASTNode[] | undefined;
  if (!args || args.length === 0) return null;

  const arg = args[0]!;
  if (arg.type !== "ObjectExpression") return null;

  // Build a map of property names to their AST value nodes
  const propMap = new Map<string, ASTNode>();
  for (const prop of (arg.properties ?? []) as ASTNode[]) {
    if (prop.type !== "Property" || prop.computed) continue;
    const key: unknown = prop.key?.type === "Identifier" ? prop.key.name : prop.key?.value;
    if (typeof key === "string") {
      propMap.set(key, prop.value as ASTNode);
    }
  }

  // uuid is required and must be a string literal
  const uuidNode = propMap.get("uuid");
  if (!uuidNode || uuidNode.type !== "Literal" || typeof uuidNode.value !== "string") {
    return null;
  }

  // info extraction (may be null if non-static or absent)
  const infoNode = propMap.get("info");
  let info: ActionManifestInfo | null = null;

  if (infoNode) {
    const evaluated = evaluateStatic(infoNode);

    if (evaluated !== UNEVALUABLE && typeof evaluated === "object" && evaluated !== null) {
      const candidate = evaluated as Record<string, unknown>;

      // Validate minimum required fields
      if (typeof candidate.name === "string" && typeof candidate.icon === "string") {
        info = candidate as unknown as ActionManifestInfo;
      }
    }
  }

  return {
    uuid: uuidNode.value as string,
    hasKey: propMap.has("key"),
    hasDial: propMap.has("dial"),
    hasTouchStrip: propMap.has("touchStrip"),
    info,
  };
}

// ── createPlugin() Action Order Extraction ──────────────────────────
//
// When the entry module contains a `createPlugin({ actions: [...] })`
// call, we extract the ordered list of action identifiers and their
// corresponding import source specifiers.  This is used by the Vite
// plugin to sort extracted actions so the manifest's actions array
// matches the developer-defined order.
//
// Strategy:
//
//   1. Walk the top-level body to collect import/export-from source
//      specifiers in AST order.  This list corresponds 1:1 with
//      Rollup's `moduleInfo.importedIds` (same order), enabling the
//      bundler plugin to resolve specifiers to absolute module IDs.
//
//   2. Build an identifier → import source mapping from import
//      declarations (only `ImportDeclaration` introduces local bindings).
//
//   3. Find the `createPlugin()` call and extract the identifiers
//      from the `actions` array in order.
//
// The bundler plugin then pairs orderedModuleSources[i] with
// importedIds[i] to build the specifier → resolvedId mapping, and
// uses the identifiers list to determine action order.

export interface PluginActionOrder {
  /** Ordered action identifiers from `createPlugin({ actions: [...] })` */
  identifiers: string[];
  /** Maps each identifier to its import source specifier (`undefined` for locals) */
  importSourceByIdentifier: Map<string, string | undefined>;
  /**
   * Import/export-from source specifiers in AST body order.
   * Corresponds 1:1 with Rollup's `moduleInfo.importedIds`.
   */
  orderedModuleSources: string[];
}

/**
 * Extract the action order from a `createPlugin()` call.
 *
 * Scans the AST for `createPlugin({ actions: [a, b, c] })` and returns
 * the ordered action identifiers along with their import source mappings.
 *
 * Returns `null` if no `createPlugin` call with an `actions` array is found.
 *
 * @param ast - ESTree-compatible AST (typically the entry module)
 * @returns Action order metadata, or null if not found
 */
export function extractCreatePluginActionOrder(ast: ASTNode): PluginActionOrder | null {
  const body = ast.body as ASTNode[] | undefined;
  if (!body || !Array.isArray(body)) return null;

  // 1. Collect all import/export-from sources in AST body order,
  //    and build identifier → source mapping from import declarations.
  //
  //    The body iteration order matters: it must match Rollup's internal
  //    processing order (ImportDeclaration, ExportNamedDeclaration with
  //    source, ExportAllDeclaration) so that orderedModuleSources[i]
  //    corresponds to importedIds[i].
  const orderedModuleSources: string[] = [];
  const identifierToSource = new Map<string, string>();

  for (const node of body) {
    const source = getModuleSourceSpecifier(node);
    if (source === null) continue;
    orderedModuleSources.push(source);

    // Only ImportDeclaration introduces local bindings
    if (node.type === "ImportDeclaration") {
      for (const spec of (node.specifiers ?? []) as ASTNode[]) {
        const localName: unknown = spec.local?.name;
        if (typeof localName === "string") {
          identifierToSource.set(localName, source);
        }
      }
    }
  }

  // 2. Find createPlugin() call and extract actions array identifiers
  const identifiers = extractActionsArrayIdentifiers(ast);

  if (identifiers.length === 0) return null;

  const importSourceByIdentifier = new Map<string, string | undefined>();
  for (const name of identifiers) {
    importSourceByIdentifier.set(name, identifierToSource.get(name));
  }

  return { identifiers, importSourceByIdentifier, orderedModuleSources };
}

// ── createPlugin() Detection ────────────────────────────────────────

function isCreatePluginCall(node: ASTNode): boolean {
  if (node.type !== "CallExpression") return false;
  const callee = node.callee as ASTNode;
  return callee?.type === "Identifier" && callee.name === "createPlugin";
}

// ── createPlugin() Actions Array Extraction ─────────────────────────
//
// Finds the first `createPlugin({ actions: [...] })` call in the AST
// and returns the ordered Identifier names from the `actions` array.
// Returns an empty array if no matching call is found.

function extractActionsArrayIdentifiers(ast: ASTNode): string[] {
  const identifiers: string[] = [];
  let found = false;

  walkAST(ast, (node) => {
    if (found) return;
    if (!isCreatePluginCall(node)) return;

    const args = node.arguments as ASTNode[] | undefined;
    if (!args?.[0] || args[0].type !== "ObjectExpression") return;

    for (const prop of (args[0].properties ?? []) as ASTNode[]) {
      if (prop.type !== "Property" || prop.computed) continue;
      const key: unknown = prop.key?.type === "Identifier" ? prop.key.name : prop.key?.value;
      if (key !== "actions") continue;

      const arr = prop.value as ASTNode;
      if (arr.type !== "ArrayExpression") continue;

      for (const el of (arr.elements ?? []) as ASTNode[]) {
        if (el?.type === "Identifier" && typeof el.name === "string") {
          identifiers.push(el.name as string);
        }
      }
      found = true;
      break;
    }
  });

  return identifiers;
}

// ── Module Source Specifier ─────────────────────────────────────────
//
// Extracts the string source specifier from import/export-from
// declarations.  Returns null for nodes that don't import a module.
//
//   ImportDeclaration         → import { x } from "source"
//   ExportNamedDeclaration    → export { x } from "source"
//   ExportAllDeclaration      → export * from "source"

function getModuleSourceSpecifier(node: ASTNode): string | null {
  switch (node.type as string) {
    case "ImportDeclaration":
    case "ExportNamedDeclaration":
    case "ExportAllDeclaration":
      return typeof node.source?.value === "string" ? (node.source.value as string) : null;
    default:
      return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Extract all `defineAction()` calls from an ESTree-compatible AST.
 *
 * Walks the entire AST looking for `defineAction({ uuid, key?, dial?,
 * touchStrip?, info? })` patterns and returns the extracted metadata.
 *
 * Actions with `info.disabled: true` are included in the results but
 * can be filtered by the caller.
 *
 * @param ast - ESTree-compatible AST
 * @returns Array of extracted action metadata
 */
export function extractActionsFromAST(ast: ASTNode): ExtractedAction[] {
  const results: ExtractedAction[] = [];

  walkAST(ast, (node) => {
    if (!isDefineActionCall(node)) return;
    const extracted = extractFromDefineAction(node);
    if (extracted) {
      results.push(extracted);
    }
  });

  return results;
}

/**
 * Convert an ExtractedAction to a ManifestActionSource for the
 * manifest generation engine.
 *
 * The `key`/`dial`/`touchStrip` fields are set to `true` (truthy)
 * when the corresponding property was present in the defineAction()
 * call, enabling the controller derivation logic in manifest-gen.ts.
 */
export function extractedToActionSource(extracted: ExtractedAction): ManifestActionSource {
  return {
    uuid: extracted.uuid,
    key: extracted.hasKey ? true : undefined,
    dial: extracted.hasDial ? true : undefined,
    touchStrip: extracted.hasTouchStrip ? true : undefined,
    info: extracted.info ?? undefined,
  };
}
