// ── SVG Serialization ───────────────────────────────────────────────
//
// Serializes a VNode <svg> subtree into an SVG markup string.
//
// Why: Takumi (the rasterization engine) treats SVG elements as images,
// not as layout containers.  When the VNode tree contains an <svg>
// node, the entire subtree must be serialized to an SVG markup string
// and wrapped as a Takumi ImageNode:
//
//   VNode tree:                    Takumi node:
//   <svg width="80" height="80">   { type: "image",
//     <circle cx="40" .../>   →      src: '<svg xmlns="...">
//   </svg>                                    <circle cx="40" .../>
//                                           </svg>' }
//
// This mirrors the behavior of @takumi-rs/helpers' SVG handler.
//
// CamelCase → kebab-case conversion:
//   React JSX uses camelCase for SVG attributes (strokeWidth, fillRule).
//   SVG markup requires kebab-case (stroke-width, fill-rule).
//   The SVG_CAMEL_ATTRS set lists all attributes that need conversion.

import type { VNode } from "@/reconciler/vnode";

// ── CamelCase SVG Attributes ────────────────────────────────────────
// These attributes must be converted from camelCase to kebab-case when
// serialized to SVG markup.

const SVG_CAMEL_ATTRS: ReadonlySet<string> = new Set([
  "accentHeight",
  "alignmentBaseline",
  "arabicForm",
  "baselineShift",
  "capHeight",
  "clipPath",
  "clipPathUnits",
  "clipRule",
  "colorInterpolation",
  "colorInterpolationFilters",
  "colorProfile",
  "colorRendering",
  "enableBackground",
  "fillOpacity",
  "fillRule",
  "floodColor",
  "floodOpacity",
  "fontFamily",
  "fontSize",
  "fontSizeAdjust",
  "fontStretch",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "glyphName",
  "glyphOrientationHorizontal",
  "glyphOrientationVertical",
  "horizAdvX",
  "horizOriginX",
  "imageRendering",
  "letterSpacing",
  "lightingColor",
  "markerEnd",
  "markerMid",
  "markerStart",
  "overlinePosition",
  "overlineThickness",
  "paintOrder",
  "pointerEvents",
  "preserveAspectRatio",
  "shapeRendering",
  "stopColor",
  "stopOpacity",
  "strokeDasharray",
  "strokeDashoffset",
  "strokeLinecap",
  "strokeLinejoin",
  "strokeMiterlimit",
  "strokeOpacity",
  "strokeWidth",
  "textAnchor",
  "textDecoration",
  "textRendering",
  "transformOrigin",
  "underlinePosition",
  "underlineThickness",
  "unicodeBidi",
  "unicodeRange",
  "unitsPerEm",
  "vAlphabetic",
  "vHanging",
  "vIdeographic",
  "vMathematical",
  "vectorEffect",
  "vertAdvY",
  "vertOriginX",
  "vertOriginY",
  "wordSpacing",
  "writingMode",
]);

// Props that should NOT be serialized as SVG attributes.
const SKIP_PROPS: ReadonlySet<string> = new Set(["children", "key", "ref", "__self", "__source"]);

// ── Helpers ─────────────────────────────────────────────────────────

function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function serializeStyle(style: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of Object.keys(style)) {
    const value = style[key];
    if (value == null) continue;
    parts.push(`${camelToKebab(key)}:${String(value).trim()}`);
  }
  return parts.join(";");
}

// ── Attribute Serialization ─────────────────────────────────────────

function serializeAttr(key: string, value: unknown): string | null {
  if (SKIP_PROPS.has(key) || value == null) return null;

  // className → class
  let attrName: string;
  if (key === "className") {
    attrName = "class";
  } else if (SVG_CAMEL_ATTRS.has(key)) {
    attrName = camelToKebab(key);
  } else {
    attrName = key;
  }

  // style object → inline CSS string
  if (key === "style" && typeof value === "object") {
    const css = serializeStyle(value as Record<string, unknown>);
    if (!css) return null;
    return `${attrName}="${escapeAttr(css)}"`;
  }

  // boolean attributes
  if (typeof value === "boolean") {
    return `${attrName}="${String(value)}"`;
  }

  return `${attrName}="${escapeAttr(String(value))}"`;
}

// ── VNode → SVG Markup ──────────────────────────────────────────────

function serializeVNode(node: VNode): string {
  // Text nodes → plain text content
  if (node.type === "#text") {
    return node.text ?? "";
  }

  // Serialize attributes
  const attrs: string[] = [];
  for (const [key, value] of Object.entries(node.props)) {
    const attr = serializeAttr(key, value);
    if (attr != null) attrs.push(attr);
  }

  // Serialize children recursively
  const childMarkup = node.children.map(serializeVNode).join("");

  const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
  return `<${node.type}${attrStr}>${childMarkup}</${node.type}>`;
}

/**
 * Serialize an `<svg>` VNode (and its entire subtree) to an SVG markup string.
 * Auto-injects `xmlns="http://www.w3.org/2000/svg"` if not present.
 * The returned string can be used as the `src` of a Takumi ImageNode.
 */
export function serializeSvgTree(svgNode: VNode): string {
  // Inject xmlns if not already present
  if (!("xmlns" in svgNode.props)) {
    const original = svgNode.props;
    svgNode.props = { ...original, xmlns: "http://www.w3.org/2000/svg" };
    const result = serializeVNode(svgNode);
    svgNode.props = original; // restore — don't mutate the VNode permanently
    return result;
  }
  return serializeVNode(svgNode);
}
