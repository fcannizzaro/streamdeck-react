# Agent Guidelines — TypeScript

Rules, patterns, and examples for contributing TypeScript code to this monorepo.

---

## 0. Repository Overview

This is a **Turborepo monorepo** managed with **Bun** (`bun@1.3.10`).

### Packages

| Package                                   | Path                                | Description                                                                                  |
| ----------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| `@fcannizzaro/streamdeck-react`           | `packages/streamdeck-react/`        | Core library — React reconciler, render pipeline, hooks, components, adapter, bundler plugin  |
| `@fcannizzaro/streamdeck-react-devtools`  | `packages/devtools/`                | Standalone DevTools UI (React + Tailwind + Zustand) for inspecting actions, events, renders   |
| `create-streamdeck-react`                 | `packages/create-streamdeck-react/` | CLI scaffolding tool (`npx create-streamdeck-react`)                                         |

### Samples

Example plugins in `samples/`: `animation`, `counter`, `jotai`, `pokemon`, `snake`, `weather`, `zustand`.

### Infrastructure

| Directory      | Purpose                                           |
| -------------- | ------------------------------------------------- |
| `docs/`        | Fumadocs documentation site (Next.js)             |
| `skills/`      | AI skill definitions for code assistants           |
| `.changeset/`  | Changesets for versioning                          |

### Key Commands

```bash
bun run build          # Build all packages (turbo)
bun run test           # Run tests for all packages
bun run dev            # Dev mode for samples
bun run typecheck      # TypeScript type checking
bun run format         # Format with oxfmt
```

---

## 1. TypeScript Patterns

### Strict Configuration

The project enforces the strictest TS settings. Never loosen them.

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `verbatimModuleSyntax: true` — always use `import type` for type-only imports.
- `noImplicitOverride: true`
- `noFallthroughCasesInSwitch: true`

### Import Style

Use `@/` path alias for intra-package imports, relative `./` only for siblings in the same directory. Always separate value and type imports.

```ts
// @/ alias for cross-directory imports
import { RootRegistry } from "@/roots/registry";
import type { PluginConfig, Plugin, ActionDefinition } from "./types";
import type { RenderConfig } from "@/render/pipeline";
```

### Export Style

Named exports only — **never** use `export default`. The barrel file (`index.ts`) re-exports the public API surface using section headers.

```ts
// ── Plugin Setup ────────────────────────────────────────────────────
export { createPlugin } from "@/plugin";
export { defineAction } from "@/action";
export type { RenderProfile } from "@/render/pipeline";

// ── Hooks — Events ──────────────────────────────────────────────────
export { useKeyDown, useKeyUp, useDialRotate } from "@/hooks/events";
```

### Types vs Interfaces

- **Interfaces** — data shapes (props, payloads, configs, contracts).
- **Type aliases** — unions, conditionals, mapped types, utility types.

```ts
// Interface: data shape
export interface FontConfig {
  name: string;
  data: ArrayBuffer | Buffer;
  weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  style: "normal" | "italic";
}

// Type alias: discriminated union
export type TouchStripLayoutItem =
  | TouchStripBarItem
  | TouchStripGBarItem
  | TouchStripPixmapItem
  | TouchStripTextItem;
```

### Generics

Use constrained generics with sensible defaults. Prefer `<S extends JsonObject = JsonObject>` so callers can opt out of providing the generic.

```ts
// Constrained generic with default
export function useSettings<S extends JsonObject = JsonObject>(): [
  S,
  (partial: Partial<S>) => void,
] {
  /* ... */
}

export function defineAction<S extends JsonObject = JsonObject>(
  config: ActionConfigInput<S>,
): ActionDefinition<S> {
  /* ... */
}

// Generic class
export class ImageCache<V = string> {
  private map = new Map<number, CacheEntry<V>>();
  // ...
}
```

### Conditional & Mapped Types

Use conditional types for manifest-driven type narrowing. Document the type-level flow with comments.

```ts
// Conditional: inspect manifest controllers tuple at the type level
type HasController<UUID extends string, C extends string> = UUID extends keyof ManifestActions
  ? ManifestActions[UUID] extends { controllers: readonly (infer Item)[] }
    ? C extends Item
      ? true
      : false
    : false
  : false;

// Mapped: produce a discriminated union from manifest entries
export type ActionConfigInput<S extends JsonObject = JsonObject> = [keyof ManifestActions] extends [
  never,
]
  ? ActionConfig<S>
  : {
      [UUID in ActionUUID]: {
        uuid: UUID;
        wrapper?: WrapperComponent;
        defaultSettings?: Partial<S>;
      } & KeySurface<UUID> &
        EncoderSurface<UUID>;
    }[ActionUUID];
```

### `satisfies` and `as const`

- Use `satisfies` to validate a value conforms to a type without widening.
- Use `as const` for literal objects that must retain their narrow types.

```ts
// satisfies: validate CSSProperties without losing literal types
{
  display: "flex",
  flexDirection: direction ?? "column",
  ...(center && { alignItems: "center", justifyContent: "center" }),
} satisfies CSSProperties

// as const: retain literal type for immutable config
const ROOT_STYLE = { display: "flex", width: "100%", height: "100%" } as const;
```

### `@internal` JSDoc

Mark implementation-detail fields that are not part of the public API.

```ts
export interface VNode {
  type: string;
  props: Record<string, unknown>;
  children: VNode[];
  /** @internal Back-pointer to parent VNode or VContainer for dirty propagation. */
  _parent?: VNode | VContainer;
  /** @internal True when this node or a descendant has been mutated since last flush. */
  _dirty?: boolean;
  /** @internal Cached Merkle hash for this subtree. */
  _hash?: number;
}
```

---

## 2. Reusability

### Hook Composition

Build higher-level hooks from small internal primitives. A private `useEvent` pattern delegates to `useCallbackRef` (stale-closure prevention), and each public hook is a thin wrapper.

```ts
// Internal: shared subscription pattern
function useEvent<T>(event: string, callback: (payload: T) => void): void {
  const bus = useContext(EventBusContext);
  const callbackRef = useCallbackRef(callback);

  useEffect(() => {
    const handler = (payload: T) => {
      callbackRef.current(payload);
    };
    bus.on(event as never, handler as never);
    return () => bus.off(event as never, handler as never);
  }, [bus, callbackRef, event]);
}

// Public: thin wrapper — one line
export function useKeyDown(callback: (payload: KeyDownPayload) => void): void {
  useEvent("keyDown", callback);
}
```

### Singleton Factories

Module-level lazy singletons with `get*()` / `reset*()` pairs. Always expose a `reset` for testing.

```ts
let sharedPool: BufferPool | null = null;

export function getBufferPool(): BufferPool {
  if (sharedPool == null) {
    sharedPool = new BufferPool();
  }
  return sharedPool;
}

export function resetBufferPool(): void {
  sharedPool?.clear();
  sharedPool = null;
}
```

Same pattern is used by `getImageCache()`, `getTouchStripCache()`, `getMetrics()`.

### Shared Interfaces

Define a common interface when multiple implementations need to be handled uniformly.

```ts
// Any root (ReactRoot, TouchStripRoot) can participate in prioritized flushing
export interface FlushableRoot {
  readonly priority: number;
  executeFlush(): Promise<void>;
}
```

### Shared Cross-Entry-Point Logic

When multiple entry points need common behavior, extract it to a shared module. `vite.ts` contains the Vite plugin and all build infrastructure (native binding copying, devtools stripping, target resolution, manifest path resolution). Additional shared modules include `font-inline.ts` (build-time font inlining), `manifest-gen.ts` (manifest JSON generation), and `manifest-extract.ts` (AST-based action metadata extraction).

### Wrapper Pattern

Accept an optional `WrapperComponent` in `createPlugin`/`defineAction` for injecting external providers (Zustand, Jotai, etc.) without modifying the library internals.

```ts
export type WrapperComponent = ComponentType<{ children?: ReactNode }>;
```

---

## 3. Code Splitting

### Feature-Based Directories

Each subdirectory is a cohesive subsystem with a single responsibility:

```
src/
├── adapter/      ← SDK abstraction layer (physical-device, types — decouples from @elgato/streamdeck)
├── reconciler/   ← React reconciler contract (vnode, host-config, renderer)
├── render/       ← Rasterization pipeline (pipeline, cache, image-cache, buffer-pool, png, svg, ...)
├── roots/        ← Root management (root, touchstrip-root, registry, flush-coordinator, recycling-pool)
├── hooks/        ← All React hooks, grouped by domain (events, gestures, settings, animation, ...)
├── context/      ← React contexts and event bus
├── components/   ← Presentational components (Box, Text, Image, Icon, ProgressBar, CircularGauge, ErrorBoundary)
├── devtools/     ← DevTools subsystem (bridge, server, serialization, intercepts, observers, highlight)
├── tw/           ← Tailwind class concatenation utility (tw)
└── test-utils/   ← Test helpers (not shipped)
```

### Multiple Package Entry Points

Use the `exports` field in `package.json` to expose distinct entry points. Bundler plugins, fonts, and the main API each have their own entry.

```json
"exports": {
  ".":        { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
  "./vite":   { "types": "./dist/vite.d.ts",   "import": "./dist/vite.js"   },
  "./font":   { "types": "./font.d.ts" }
}
```

### Worker Isolation

Worker files (`render/worker.ts`) are self-contained. They intentionally duplicate some logic (SVG serialization, VNode-to-Takumi conversion) because workers cannot import from the main bundle. This trade-off is documented in comments.

### Test Co-Location

Tests live in `__tests__/` subdirectories alongside their source:

```
src/render/__tests__/cache.test.ts
src/hooks/__tests__/events.test.tsx
src/roots/__tests__/root.test.tsx
```

---

## 4. Readability

### Naming

- **Functions/methods** — verb-first, describe what they do: `computeCacheKey`, `markDirty`, `requestFlush`, `getBufferPool`.
- **Classes** — noun, describe what they are: `BufferPool`, `FlushCoordinator`, `ImageCache`.
- **Types/Interfaces** — noun or adjective-noun: `FlushableRoot`, `CacheStats`, `ActionConfigInput`.
- **Constants** — `UPPER_SNAKE_CASE`: `FNV_OFFSET_BASIS`, `MAX_POOL_SIZE_PER_BUCKET`.

### Small, Focused Files

Each file has a single responsibility. If a file grows beyond one clear purpose, split it.

### Consistent Internal Patterns

Repeat the same structural pattern across subsystems so that learning one teaches all. Examples:

- All event hooks use the `useEvent` → `useCallbackRef` chain.
- All singletons use `get*()` / `reset*()`.
- All components use `createElement` + conditional spread for optional props.

### Component Shorthand Props

Use the conditional spread pattern for optional CSS shorthands. Omitted props fall through to defaults.

```ts
export function Box({ center, padding, background, style, children }: BoxProps): ReactElement {
  return createElement(
    "div",
    {
      style: {
        display: "flex",
        ...(center && { alignItems: "center", justifyContent: "center" }),
        ...(padding !== undefined && { padding }),
        ...(background !== undefined && { backgroundColor: background }),
        ...style,
      } satisfies CSSProperties,
    },
    children,
  );
}
```

---

## 5. Performance

When implementing a new feature, **always check for existing utilities first**. Do not reinvent caching, hashing, pooling, or batching.

### Existing Performance Utilities

| Module                       | Exports                                                                                  | Use For                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `render/cache.ts`            | `fnv1a`, `fnv1aString`, `hashValue`, `computeHash`, `computeTreeHash`, `computeCacheKey` | Hashing buffers, values, VNode trees, cache keys |
| `render/image-cache.ts`      | `ImageCache`, `getImageCache()`, `getTouchStripCache()`, `resetCaches()`                 | Byte-bounded LRU caching for rendered images     |
| `render/buffer-pool.ts`      | `BufferPool`, `getBufferPool()`, `resetBufferPool()`                                     | Reusable buffer allocation (reduces GC)          |
| `render/metrics.ts`          | `RenderMetrics`, `getMetrics()`                                                          | Rolling-window render performance tracking       |
| `render/render-pool.ts`      | `RenderPool`                                                                             | Worker thread pool for offloading Takumi         |
| `roots/flush-coordinator.ts` | `FlushCoordinator`, `FlushableRoot`                                                      | Priority-ordered microtask batching              |

### 4-Phase Skip Hierarchy

The render pipeline uses a 4-phase skip hierarchy. New features must respect it:

```
Phase 1: Dirty-flag check (O(1))
  └─ skip if no VNode mutated since last flush

Phase 2: Merkle hash + image cache lookup
  └─ skip if tree hash matches a cached render

Phase 3: Takumi render (main thread or worker)
  └─ rasterize SVG → raw pixels → PNG/data URI

Phase 4: FNV-1a output dedup
  └─ skip hardware push if output identical to last frame
```

### Rules

- **Use `getBufferPool().acquire()` / `release()`** instead of `Buffer.alloc()` in hot paths.
- **Use `getImageCache()`** before re-rendering — check the cache first.
- **Respect adaptive debounce** — 0ms for animating roots, 16ms for interactive, configured ms for idle.
- **Never queue unbounded renders** — use the `_rendering` + `_pendingFlush` flag pattern to coalesce.
- **Prefer `queueMicrotask`** over `setTimeout(0)` for flush coordination.

---

## 6. Code Commenting

### Do

- **Add extended, useful comments** — focus on the **"why"**, not the "what". Explain rationale, trade-offs, and non-obvious behavior.

```ts
// Why sequential (not parallel):
//   The Stream Deck USB connection serializes write operations.
//   Parallel hardware pushes just queue in the USB driver anyway.
//   Sequential processing gives animated/interactive keys guaranteed
//   first access to the USB bus, reducing perceived latency.
```

- **Use module-level section headers** with the `// ──` format:

```ts
// ── Flush Coordinator ────────────────────────────────────────────────
//
// Batches and priority-orders flush requests from multiple ReactRoot
// and TouchStripRoot instances.
```

- **Use section separators** within files for logical groupings:

```ts
// ── Constants ───────────────────────────────────────────────────────

// ── Low-Level Hash Primitives ───────────────────────────────────────

// ── Per-VNode Merkle Hash ───────────────────────────────────────────
```

- **Add ASCII diagrams/flow** when explaining architecture, data structures, or tree layouts:

```ts
//   ┌──────────────────────────────────────────────┐
//   │  Map<hash, CacheEntry>   (O(1) lookup)       │
//   │                                              │
//   │  head ←→ entry ←→ entry ←→ ... ←→ tail      │
//   │  (MRU)   doubly-linked list       (LRU)      │
//   └──────────────────────────────────────────────┘

//   VContainer (root)
//     ├─ _dirty: bool
//     └─ children: VNode[]
//          ├─ VNode { type, props, _dirty, _hash, _hashValid }
//          │    ├─ _parent ↑ (back-pointer)
//          │    └─ children: VNode[]
//          └─ VNode ...
```

- **Document performance/architectural rationale** in comments:

```ts
// Why this matters:
//   At 30fps TouchStrip rendering, each frame allocates ~320KB of raw RGBA
//   buffers (800×100×4).  Without pooling, V8's GC must collect ~10MB/s
//   of short-lived buffers, causing periodic frame drops.
```

- **Use JSDoc** on public API members with `@param`, `@default`, `@example` tags.
- **Use `@internal`** on implementation-detail fields.

### Do Not

- **Do not add obvious comments** — no `// increment counter`, `// return the value`, `// import React`.
- **Do not comment test files** — tests should be self-documenting through descriptive test names.
- **Do not comment barrel exports** (`index.ts`) beyond section headers.
- **Do not use `/* */` block comments** for documentation — use `//` style for consistency.

---

## 7. Documentation & Skills Updates

After implementing a **complete feature**:

1. The `./docs` directory (Fumadocs site) and `./skills` directory (AI skill definitions) should be updated to reflect the new feature.
2. **Always ask before updating** — only proceed after the feature has been tested in a real environment (IRL on actual Stream Deck hardware or in a realistic integration test).
3. Never proactively update docs/skills until the user confirms the feature is ready.
