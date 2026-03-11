import { describe, expect, test } from "bun:test";
import {
  createVNode,
  createTextVNode,
  createVContainer,
  markDirty,
  markContainerDirty,
  isContainerDirty,
  clearDirtyFlags,
  setParent,
  clearParent,
  vnodeToElement,
} from "@/reconciler/vnode";
import type { VNode, VContainer } from "@/reconciler/vnode";

// ── Factory Functions ───────────────────────────────────────────────

describe("createVNode", () => {
  test("creates a node with type, props, and empty children", () => {
    const node = createVNode("div", { color: "red" });

    expect(node.type).toBe("div");
    expect(node.props).toEqual({ color: "red" });
    expect(node.children).toEqual([]);
  });

  test("text field is undefined by default", () => {
    const node = createVNode("span", {});
    expect(node.text).toBeUndefined();
  });
});

describe("createTextVNode", () => {
  test("creates a #text node with the given text", () => {
    const node = createTextVNode("Hello");

    expect(node.type).toBe("#text");
    expect(node.text).toBe("Hello");
    expect(node.children).toEqual([]);
    expect(node.props).toEqual({});
  });
});

describe("createVContainer", () => {
  test("creates a container with default values", () => {
    const cb = () => {};
    const container = createVContainer(cb);

    expect(container.children).toEqual([]);
    expect(container.scheduledRender).toBe(false);
    expect(container.lastSvgHash).toBe(0);
    expect(container.renderCallback).toBe(cb);
    expect(container.renderTimer).toBeNull();
    expect(container._dupCount).toBe(0);
    expect(container._dirty).toBe(true); // starts dirty for first render
  });
});

// ── Dirty Flag Propagation ──────────────────────────────────────────

describe("markDirty", () => {
  test("marks a node and its ancestors dirty", () => {
    const container = createVContainer(() => {});
    const parent = createVNode("div", {});
    const child = createVNode("span", {});

    setParent(parent, container);
    setParent(child, parent);
    parent.children.push(child);
    container.children.push(parent);

    // Clear initial dirty state
    clearDirtyFlags(container);
    expect(parent._dirty).toBeFalsy();
    expect(child._dirty).toBeFalsy();
    expect(container._dirty).toBe(false);

    markDirty(child);

    expect(child._dirty).toBe(true);
    expect(parent._dirty).toBe(true);
    expect(container._dirty).toBe(true);
  });

  test("invalidates _hashValid on marked nodes", () => {
    const node = createVNode("div", {});
    node._hashValid = true;
    node._hash = 12345;

    markDirty(node);

    expect(node._hashValid).toBe(false);
  });

  test("preserves cached sorted prop keys until props are replaced", () => {
    const node = createVNode("div", { b: 2, a: 1 });
    node._sortedPropKeys = ["a", "b"];

    markDirty(node);

    expect(node._sortedPropKeys).toEqual(["a", "b"]);
  });

  test("stops propagation when ancestor is already dirty", () => {
    const container = createVContainer(() => {});
    const grandparent = createVNode("div", {});
    const parent = createVNode("span", {});
    const child = createVNode("p", {});

    setParent(grandparent, container);
    setParent(parent, grandparent);
    setParent(child, parent);
    grandparent.children.push(parent);
    parent.children.push(child);
    container.children.push(grandparent);

    // Clear, then make grandparent dirty
    clearDirtyFlags(container);
    grandparent._dirty = true;

    // Mark child — should stop at grandparent
    markDirty(child);

    expect(child._dirty).toBe(true);
    expect(parent._dirty).toBe(true);
    expect(grandparent._dirty).toBe(true);
  });
});

describe("markContainerDirty", () => {
  test("sets container _dirty to true", () => {
    const container = createVContainer(() => {});
    container._dirty = false;

    markContainerDirty(container);

    expect(container._dirty).toBe(true);
  });
});

describe("isContainerDirty", () => {
  test("returns the dirty state of the container", () => {
    const container = createVContainer(() => {});

    expect(isContainerDirty(container)).toBe(true);

    container._dirty = false;
    expect(isContainerDirty(container)).toBe(false);
  });
});

describe("clearDirtyFlags", () => {
  test("clears dirty flags on container and all descendants", () => {
    const container = createVContainer(() => {});
    const parent = createVNode("div", {});
    const child = createVNode("span", {});

    setParent(parent, container);
    setParent(child, parent);
    parent.children.push(child);
    container.children.push(parent);

    markDirty(child);

    expect(container._dirty).toBe(true);
    expect(parent._dirty).toBe(true);
    expect(child._dirty).toBe(true);

    clearDirtyFlags(container);

    expect(container._dirty).toBe(false);
    expect(parent._dirty).toBeFalsy();
    expect(child._dirty).toBeFalsy();
  });

  test("skips clean subtrees for efficiency", () => {
    const container = createVContainer(() => {});
    const cleanNode = createVNode("div", {});
    const dirtyNode = createVNode("span", {});
    const dirtyChild = createVNode("p", {});

    setParent(cleanNode, container);
    setParent(dirtyNode, container);
    setParent(dirtyChild, dirtyNode);
    dirtyNode.children.push(dirtyChild);
    container.children.push(cleanNode);
    container.children.push(dirtyNode);

    // Only mark dirtyNode branch
    clearDirtyFlags(container);
    markDirty(dirtyChild);

    clearDirtyFlags(container);

    expect(dirtyChild._dirty).toBeFalsy();
    expect(dirtyNode._dirty).toBeFalsy();
  });
});

// ── Parent Back-Pointer Management ──────────────────────────────────

describe("setParent / clearParent", () => {
  test("setParent sets the _parent back-pointer", () => {
    const parent = createVNode("div", {});
    const child = createVNode("span", {});

    setParent(child, parent);

    expect(child._parent).toBe(parent);
  });

  test("clearParent removes the _parent back-pointer", () => {
    const parent = createVNode("div", {});
    const child = createVNode("span", {});

    setParent(child, parent);
    clearParent(child);

    expect(child._parent).toBeUndefined();
  });
});

// ── vnodeToElement ──────────────────────────────────────────────────

describe("vnodeToElement", () => {
  test("converts text node to string", () => {
    const node = createTextVNode("Hello world");
    const element = vnodeToElement(node);
    expect(element).toBe("Hello world");
  });

  test("returns empty string for text node with undefined text", () => {
    const node: VNode = { type: "#text", props: {}, children: [], text: undefined };
    const element = vnodeToElement(node);
    expect(element).toBe("");
  });

  test("converts element node to React element", () => {
    const node = createVNode("div", { style: { color: "red" } });
    const element = vnodeToElement(node) as any;

    expect(element.type).toBe("div");
    expect(element.props.style).toEqual({ color: "red" });
  });

  test("maps className to tw prop", () => {
    const node = createVNode("div", { className: "flex items-center" });
    const element = vnodeToElement(node) as any;

    expect(element.props.tw).toBe("flex items-center");
    expect(element.props.className).toBeUndefined();
  });

  test("appends className to existing tw prop", () => {
    const node = createVNode("div", { tw: "p-4", className: "flex" });
    const element = vnodeToElement(node) as any;

    expect(element.props.tw).toBe("p-4 flex");
  });

  test("children prop is not passed through to element", () => {
    const parent = createVNode("div", { children: "ignored" });
    const child = createTextVNode("Hello");
    parent.children.push(child);

    const element = vnodeToElement(parent) as any;
    // Single child — React's createElement unwraps it (no array wrapper)
    expect(element.props.children).toBe("Hello");
  });

  test("recursively converts child nodes", () => {
    const parent = createVNode("div", {});
    const child1 = createVNode("span", {});
    const child2 = createTextVNode("World");
    const textChild = createTextVNode("Hi");

    child1.children.push(textChild);
    parent.children.push(child1);
    parent.children.push(child2);

    const element = vnodeToElement(parent) as any;
    // With 2 children, React wraps in an array
    const [spanElement, textElement] = element.props.children;

    expect(spanElement.type).toBe("span");
    expect(spanElement.props.children).toBe("Hi");
    expect(textElement).toBe("World");
  });
});
