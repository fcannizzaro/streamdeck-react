import { createContext } from "react";
import { DefaultEventPriority } from "react-reconciler/constants.js";
import {
  createVNode,
  createTextVNode,
  type VNode,
  type VContainer,
} from "./vnode";

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

  appendInitialChild(parent: VNode, child: VNode): void {
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

  appendChild(parent: VNode, child: VNode): void {
    parent.children.push(child);
  },

  appendChildToContainer(container: VContainer, child: VNode): void {
    container.children.push(child);
  },

  insertBefore(parent: VNode, child: VNode, beforeChild: VNode): void {
    const index = parent.children.indexOf(beforeChild);
    if (index >= 0) {
      parent.children.splice(index, 0, child);
    } else {
      parent.children.push(child);
    }
  },

  insertInContainerBefore(
    container: VContainer,
    child: VNode,
    beforeChild: VNode,
  ): void {
    const index = container.children.indexOf(beforeChild);
    if (index >= 0) {
      container.children.splice(index, 0, child);
    } else {
      container.children.push(child);
    }
  },

  removeChild(parent: VNode, child: VNode): void {
    const index = parent.children.indexOf(child);
    if (index >= 0) {
      parent.children.splice(index, 1);
    }
  },

  removeChildFromContainer(container: VContainer, child: VNode): void {
    const index = container.children.indexOf(child);
    if (index >= 0) {
      container.children.splice(index, 1);
    }
  },

  commitUpdate(
    instance: VNode,
    _type: string,
    _oldProps: Record<string, unknown>,
    newProps: Record<string, unknown>,
  ): void {
    const { children: _, ...cleanProps } = newProps;
    instance.props = cleanProps;
  },

  commitTextUpdate(
    textInstance: VNode,
    _oldText: string,
    newText: string,
  ): void {
    textInstance.text = newText;
  },

  hideInstance(): void {},
  unhideInstance(): void {},
  hideTextInstance(): void {},
  unhideTextInstance(): void {},

  clearContainer(container: VContainer): void {
    container.children = [];
  },

  // ── Scheduling Primitives ─────────────────────────────────────

  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  scheduleMicrotask: queueMicrotask,

  preparePortalMount: () => {},
};
