import { describe, expect, test } from "bun:test";
import { fuzz, gen, setSeed } from "@/test-utils/fuzz";
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
} from "@/reconciler/vnode";

// ── VNode Fuzz Tests ────────────────────────────────────────────────
//
// Exercises the VNode tree operations and dirty flag propagation with
// randomized tree structures.  Verifies:
//
//   1. markDirty propagates correctly through any tree shape
//   2. clearDirtyFlags resets all nodes
//   3. Parent back-pointers are maintained correctly
//   4. No crashes on degenerate tree shapes (empty, single-node, deep)

setSeed(42);

describe("fuzz: VNode tree operations", () => {
  test("markDirty propagates to container for any tree depth (500 iterations)", () => {
    fuzz(500, () => {
      const container = createVContainer(() => {});
      container._dirty = false;

      const depth = gen.int(1, 20);
      const nodes = [createVNode("div", {})];
      setParent(nodes[0]!, container);
      container.children.push(nodes[0]!);

      for (let i = 1; i < depth; i++) {
        const child = createVNode("span", {});
        const parent = nodes[i - 1]!;
        setParent(child, parent);
        parent.children.push(child);
        nodes.push(child);
      }

      // Mark the deepest node dirty
      const leaf = nodes[nodes.length - 1]!;
      markDirty(leaf);

      // Container should be dirty
      expect(isContainerDirty(container)).toBe(true);

      // All nodes on the path should be dirty
      for (const node of nodes) {
        expect(node._dirty).toBe(true);
      }
    });
  });

  test("clearDirtyFlags resets entire tree (500 iterations)", () => {
    fuzz(500, () => {
      const container = createVContainer(() => {});

      const childCount = gen.int(1, 8);
      for (let i = 0; i < childCount; i++) {
        const child = createVNode("div", {});
        setParent(child, container);
        child._dirty = true;
        container.children.push(child);

        if (gen.bool()) {
          const grandchild = createVNode("span", {});
          setParent(grandchild, child);
          grandchild._dirty = true;
          child.children.push(grandchild);
        }
      }

      container._dirty = true;
      clearDirtyFlags(container);

      expect(container._dirty).toBe(false);
      for (const child of container.children) {
        expect(child._dirty).toBeFalsy();
        for (const gc of child.children) {
          expect(gc._dirty).toBeFalsy();
        }
      }
    });
  });

  test("markDirty early-exits when already dirty (performance invariant)", () => {
    const container = createVContainer(() => {});
    container._dirty = false;

    const root = createVNode("div", {});
    setParent(root, container);
    container.children.push(root);

    const childA = createVNode("span", {});
    setParent(childA, root);
    root.children.push(childA);

    const childB = createVNode("b", {});
    setParent(childB, root);
    root.children.push(childB);

    // Mark A dirty — propagates to root and container
    markDirty(childA);
    expect(root._dirty).toBe(true);
    expect(container._dirty).toBe(true);

    // Mark B dirty — should early-exit at root (already dirty)
    markDirty(childB);
    // Still all dirty (no-op on already-dirty ancestors)
    expect(childB._dirty).toBe(true);
    expect(root._dirty).toBe(true);
    expect(container._dirty).toBe(true);
  });

  test("setParent/clearParent doesn't crash on rapid operations (500 iterations)", () => {
    fuzz(500, () => {
      const container = createVContainer(() => {});
      const node = createVNode("div", {});

      setParent(node, container);
      expect(node._parent).toBe(container);

      clearParent(node);
      expect(node._parent).toBeUndefined();

      // Re-parent to a different node
      const parent = createVNode("section", {});
      setParent(node, parent);
      expect(node._parent).toBe(parent);
    });
  });

  test("markDirty on orphaned node (no parent) doesn't crash", () => {
    const orphan = createVNode("div", {});
    // No parent set — markDirty should just mark this node and stop
    expect(() => markDirty(orphan)).not.toThrow();
    expect(orphan._dirty).toBe(true);
  });

  test("createTextVNode with random content never crashes (500 iterations)", () => {
    fuzz(500, () => {
      const text = gen.string(0, 200);
      const node = createTextVNode(text);
      expect(node.type).toBe("#text");
      expect(node.text).toBe(text);
      expect(node.children).toEqual([]);
    });
  });

  test("wide trees with many siblings (200 iterations)", () => {
    fuzz(200, () => {
      const container = createVContainer(() => {});
      const siblingCount = gen.int(0, 50);

      for (let i = 0; i < siblingCount; i++) {
        const child = createVNode("div", { key: i });
        setParent(child, container);
        container.children.push(child);
      }

      // Mark a random sibling dirty
      if (container.children.length > 0) {
        const idx = gen.int(0, container.children.length - 1);
        markDirty(container.children[idx]!);
        expect(isContainerDirty(container)).toBe(true);
      }

      clearDirtyFlags(container);
      expect(container._dirty).toBe(false);
    });
  });
});
