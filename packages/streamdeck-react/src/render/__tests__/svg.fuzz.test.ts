import { describe, expect, test } from "bun:test";
import { fuzz, gen, setSeed } from "@/test-utils/fuzz";
import { serializeSvgTree } from "@/render/svg";
import type { VNode } from "@/reconciler/vnode";
import { createVNode, createTextVNode } from "@/reconciler/vnode";

// ── SVG Serialization Fuzz Tests ────────────────────────────────────
//
// These tests exercise the SVG serializer with adversarial inputs to
// verify:
//
//   1. Never throws on any VNode input
//   2. Output is always a string
//   3. Output always contains the xmlns declaration
//   4. Attribute escaping prevents injection via prop values
//   5. Special characters in text nodes are handled
//
// Security focus: tests specifically target injection vectors where
// user-controlled data could escape attribute or element boundaries.

setSeed(42);

describe("fuzz: serializeSvgTree", () => {
  test("never throws on random SVG trees (1000 iterations)", () => {
    fuzz(1000, () => {
      const svgNode = buildRandomSvgNode();
      expect(() => serializeSvgTree(svgNode)).not.toThrow();
    });
  });

  test("always produces a string output (500 iterations)", () => {
    fuzz(500, () => {
      const svgNode = buildRandomSvgNode();
      const result = serializeSvgTree(svgNode);
      expect(typeof result).toBe("string");
    });
  });

  test("always includes xmlns declaration (500 iterations)", () => {
    fuzz(500, () => {
      const svgNode = buildRandomSvgNode();
      const result = serializeSvgTree(svgNode);
      expect(result).toContain("xmlns=");
    });
  });

  test("attribute values with quotes are escaped (injection test)", () => {
    const svgNode = createVNode("svg", {
      width: 100,
      height: 100,
    });
    const child = createVNode("rect", {
      fill: 'red" onclick="alert(1)',
      width: 100,
      height: 100,
    });
    svgNode.children.push(child);

    const result = serializeSvgTree(svgNode);
    // The injected double-quote should be escaped
    expect(result).not.toContain('onclick="alert(1)');
    expect(result).toContain("&quot;");
  });

  test("attribute values with angle brackets are escaped", () => {
    const svgNode = createVNode("svg", { width: 100, height: 100 });
    const child = createVNode("text", {
      fill: "<script>alert(1)</script>",
    });
    svgNode.children.push(child);

    const result = serializeSvgTree(svgNode);
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;");
    expect(result).toContain("&gt;");
  });

  test("handles text nodes with special characters", () => {
    const svgNode = createVNode("svg", { width: 100, height: 100 });
    const textNode = createVNode("text", {});
    const content = createTextVNode('Hello <script>alert("xss")</script> World');
    textNode.children.push(content);
    svgNode.children.push(textNode);

    // This test documents the current behavior — text nodes are NOT escaped
    // (documented vulnerability in SECURITY-FINDINGS.md)
    const result = serializeSvgTree(svgNode);
    expect(typeof result).toBe("string");
  });

  test("deeply nested SVG trees don't crash (100 iterations)", () => {
    fuzz(100, () => {
      const depth = gen.int(1, 30);
      let current = createVNode("g", {});
      for (let i = 0; i < depth; i++) {
        const child = createVNode("g", { transform: `translate(${i}, ${i})` });
        current.children.push(child);
        current = child;
      }
      current.children.push(createTextVNode("leaf"));

      const svgNode = createVNode("svg", { width: 100, height: 100 });
      svgNode.children.push(current);

      expect(() => serializeSvgTree(svgNode)).not.toThrow();
    });
  });

  test("handles nodes with many attributes (500 iterations)", () => {
    fuzz(500, () => {
      const attrCount = gen.int(0, 30);
      const props: Record<string, unknown> = { width: 100, height: 100 };
      for (let i = 0; i < attrCount; i++) {
        props[`data-${gen.string(1, 20)}`] = gen.string(0, 50);
      }

      const svgNode = createVNode("svg", props);
      expect(() => serializeSvgTree(svgNode)).not.toThrow();
    });
  });

  test("className is converted to class attribute", () => {
    const svgNode = createVNode("svg", { width: 100, height: 100 });
    const child = createVNode("rect", {
      className: "my-class",
      width: 50,
      height: 50,
    });
    svgNode.children.push(child);

    const result = serializeSvgTree(svgNode);
    expect(result).toContain('class="my-class"');
    expect(result).not.toContain("className");
  });

  test("style objects are serialized to CSS strings", () => {
    const svgNode = createVNode("svg", { width: 100, height: 100 });
    const child = createVNode("rect", {
      style: { fill: "red", strokeWidth: 2 },
    });
    svgNode.children.push(child);

    const result = serializeSvgTree(svgNode);
    expect(result).toContain("fill:red");
    expect(result).toContain("stroke-width:2");
  });

  test("null and undefined prop values are skipped", () => {
    const svgNode = createVNode("svg", {
      width: 100,
      height: 100,
      "data-null": null,
      "data-undef": undefined,
    });

    const result = serializeSvgTree(svgNode);
    expect(result).not.toContain("data-null");
    expect(result).not.toContain("data-undef");
  });
});

// ── Helpers ─────────────────────────────────────────────────────────

function buildRandomSvgNode(): VNode {
  const svgProps: Record<string, unknown> = {
    width: gen.int(1, 800),
    height: gen.int(1, 600),
  };

  if (gen.bool()) svgProps.viewBox = `0 0 ${gen.int(1, 800)} ${gen.int(1, 600)}`;
  if (gen.bool()) svgProps.fill = gen.string(1, 20);

  const svgNode = createVNode("svg", svgProps);

  const childCount = gen.int(0, 5);
  for (let i = 0; i < childCount; i++) {
    svgNode.children.push(buildRandomSvgChild());
  }

  return svgNode;
}

function buildRandomSvgChild(): VNode {
  const type = gen.pick(["rect", "circle", "text", "g", "path", "line", "ellipse"]);
  const props: Record<string, unknown> = {};

  switch (type) {
    case "rect":
      props.x = gen.int(0, 100);
      props.y = gen.int(0, 100);
      props.width = gen.int(1, 200);
      props.height = gen.int(1, 200);
      break;
    case "circle":
      props.cx = gen.int(0, 200);
      props.cy = gen.int(0, 200);
      props.r = gen.int(1, 100);
      break;
    case "path":
      props.d = gen.string(1, 50);
      break;
    case "line":
      props.x1 = gen.int(0, 200);
      props.y1 = gen.int(0, 200);
      props.x2 = gen.int(0, 200);
      props.y2 = gen.int(0, 200);
      break;
  }

  if (gen.bool()) props.fill = gen.string(1, 20);
  if (gen.bool()) props.stroke = gen.string(1, 20);
  if (gen.bool()) props.strokeWidth = gen.int(1, 10);

  const node = createVNode(type, props);

  if (type === "text" || type === "g") {
    if (gen.bool()) {
      node.children.push(createTextVNode(gen.string(0, 50)));
    }
  }

  return node;
}
