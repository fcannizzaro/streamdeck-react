import { createContext } from "react";
import { DefaultEventPriority } from "react-reconciler/constants.js";
import {
  createVNode,
  createTextVNode,
  markDirty,
  markContainerDirty,
  setParent,
  clearParent,
  type VNode,
  type VContainer,
} from "./vnode";

// ── react-reconciler Host Config ────────────────────────────────────
//
// This module implements the contract required by `react-reconciler` to
// drive a custom rendering target.  The reconciler operates in MUTATION
// MODE (not persistent): React diffs the fiber tree, then calls our
// mutation methods (appendChild, removeChild, commitUpdate, etc.) to
// patch the VNode tree in place.
//
// Data flow per React commit:
//
//   React setState / props change
//     ↓
//   Reconciler diffs fiber tree
//     ↓
//   Mutation methods called on VNode tree
//   (appendChild, commitUpdate, commitTextUpdate, etc.)
//     ↓
//   Each mutation calls markDirty() → propagates up _parent chain
//     ↓
//   resetAfterCommit() fires → schedules microtask
//     ↓
//   Microtask runs container.renderCallback()
//     ↓
//   ReactRoot.flush() → render pipeline (pipeline.ts)
//
// Why microtask (not setTimeout):
//   React may produce multiple commits in a single event loop tick
//   (e.g. batched state updates).  A microtask fires after all
//   synchronous commits complete but before the next macrotask,
//   coalescing multiple commits into one render pass.
//
// No-op stubs: React's reconciler requires many methods that don't
// apply to this renderer (hydration, portals, transitions, suspense).
// They are stubbed to satisfy the type contract.

// ── No-op / Stub values ────────────────────────────────────────────

const NO_CONTEXT = {};

// ── HostConfig Implementation ───────────────────────────────────────
// The reconciler uses mutation mode: we build a virtual VNode tree
// in memory, then serialize it to SVG via Satori on each commit.

export const hostConfig = {
  // ── Configuration ─────────────────────────────────────────────

  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: true,
  noTimeout: -1 as const,

  // ── Scheduling ────────────────────────────────────────────────

  now: Date.now,
  getCurrentEventPriority: () => DefaultEventPriority,
  getInstanceFromNode: () => null,
  prepareScopeUpdate: () => {},
  getInstanceFromScope: () => null,
  detachDeletedInstance: () => {},
  beforeActiveInstanceBlur: () => {},
  afterActiveInstanceBlur: () => {},
  setCurrentUpdatePriority: () => {},
  getCurrentUpdatePriority: () => DefaultEventPriority,
  resolveUpdatePriority: () => DefaultEventPriority,
  shouldAttemptEagerTransition: () => false,
  requestPostPaintCallback: () => {},
  maySuspendCommit: () => false,
  preloadInstance: () => true,
  startSuspendingCommit: () => {},
  suspendInstance: () => {},
  waitForCommitToBeReady: () => null,
  NotPendingTransition: null as null,
  resetFormInstance: () => {},
  trackSchedulerEvent: () => {},

  // ── Transition Support ────────────────────────────────────────

  HostTransitionContext: createContext(null) as never,
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,

  // ── Context ───────────────────────────────────────────────────

  getRootHostContext: () => NO_CONTEXT,
  getChildHostContext: () => NO_CONTEXT,

  // ── Instance Creation ─────────────────────────────────────────

  createInstance(type: string, props: Record<string, unknown>): VNode {
    const { children: _, ...cleanProps } = props;
    return createVNode(type, cleanProps);
  },

  createTextInstance(text: string): VNode {
    return createTextVNode(text);
  },

  shouldSetTextContent(): boolean {
    return false;
  },

  // ── Initial Tree Building ─────────────────────────────────────
  // Called during the render phase for the initial mount.
  // Sets _parent directly (no markDirty needed — the container
  // starts dirty and the initial render hasn't flushed yet).

  appendInitialChild(parent: VNode, child: VNode): void {
    child._parent = parent;
    parent.children.push(child);
  },

  finalizeInitialChildren(): boolean {
    return false;
  },

  // ── Public Instance ───────────────────────────────────────────

  getPublicInstance(instance: VNode): VNode {
    return instance;
  },

  // ── Prepare for Commit ────────────────────────────────────────

  prepareForCommit(): null {
    return null;
  },

  resetAfterCommit(container: VContainer): void {
    if (!container.scheduledRender) {
      container.scheduledRender = true;
      queueMicrotask(() => {
        container.scheduledRender = false;
        try {
          container.renderCallback();
        } catch (err) {
          console.error("[@fcannizzaro/streamdeck-react] Commit render error:", err);
        }
      });
    }
  },

  // ── Update Detection ──────────────────────────────────────────
  // Shallow prop comparison — returns true (needs update) or null
  // (no change).  Skips 'children' prop (handled by tree structure).
  // This is called during the render phase to determine if
  // commitUpdate needs to run during the commit phase.

  prepareUpdate(
    _instance: VNode,
    _type: string,
    oldProps: Record<string, unknown>,
    newProps: Record<string, unknown>,
  ): boolean | null {
    const oldKeys = Object.keys(oldProps);
    const newKeys = Object.keys(newProps);

    if (oldKeys.length !== newKeys.length) return true;

    for (const key of newKeys) {
      if (key === "children") continue;
      if (oldProps[key] !== newProps[key]) return true;
    }

    return null;
  },

  // ── Mutation Methods ──────────────────────────────────────────
  // Called during the commit phase to apply changes to the VNode
  // tree.  Every mutation sets the parent back-pointer and calls
  // markDirty() to propagate dirty flags up to the container.

  appendChild(parent: VNode, child: VNode): void {
    setParent(child, parent);
    parent.children.push(child);
    markDirty(parent);
  },

  appendChildToContainer(container: VContainer, child: VNode): void {
    setParent(child, container);
    container.children.push(child);
    markContainerDirty(container);
  },

  insertBefore(parent: VNode, child: VNode, beforeChild: VNode): void {
    setParent(child, parent);
    const index = parent.children.indexOf(beforeChild);
    if (index >= 0) {
      parent.children.splice(index, 0, child);
    } else {
      parent.children.push(child);
    }
    markDirty(parent);
  },

  insertInContainerBefore(container: VContainer, child: VNode, beforeChild: VNode): void {
    setParent(child, container);
    const index = container.children.indexOf(beforeChild);
    if (index >= 0) {
      container.children.splice(index, 0, child);
    } else {
      container.children.push(child);
    }
    markContainerDirty(container);
  },

  removeChild(parent: VNode, child: VNode): void {
    const index = parent.children.indexOf(child);
    if (index >= 0) {
      parent.children.splice(index, 1);
    }
    clearParent(child);
    markDirty(parent);
  },

  removeChildFromContainer(container: VContainer, child: VNode): void {
    const index = container.children.indexOf(child);
    if (index >= 0) {
      container.children.splice(index, 1);
    }
    clearParent(child);
    markContainerDirty(container);
  },

  commitUpdate(
    instance: VNode,
    _type: string,
    _oldProps: Record<string, unknown>,
    newProps: Record<string, unknown>,
  ): void {
    const { children: _, ...cleanProps } = newProps;
    instance.props = cleanProps;
    markDirty(instance);
  },

  commitTextUpdate(textInstance: VNode, _oldText: string, newText: string): void {
    textInstance.text = newText;
    markDirty(textInstance);
  },

  hideInstance(): void {},
  unhideInstance(): void {},
  hideTextInstance(): void {},
  unhideTextInstance(): void {},

  clearContainer(container: VContainer): void {
    for (const child of container.children) {
      clearParent(child);
    }
    container.children = [];
    markContainerDirty(container);
  },

  // ── Scheduling Primitives ─────────────────────────────────────

  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  scheduleMicrotask: queueMicrotask,

  preparePortalMount: () => {},
};
