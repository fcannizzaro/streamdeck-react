# Limitations & Trade-offs

## Styling Constraints

The renderer is NOT a browser DOM. Keep layouts simple and explicit.

- Use inline styles, `className` with Tailwind classes, or `tw()` utility strings.
- Prefer fixed sizes, percentages, and straightforward flex layouts.
- Load every font you plan to render explicitly -- the renderer cannot access system fonts.
- Supported font formats: `.ttf`, `.otf`, `.woff`. WOFF2 is **not supported**.

## Supported JSX Elements

Use simple HTML/SVG primitives and the built-in components:

| Element | Purpose |
|---------|---------|
| `div` | Container / layout (default `display: flex`) |
| `span` | Inline text container |
| `p` | Paragraph text |
| `img` | Images (requires `width` and `height`) |
| `svg` | Inline SVG for icons and gauges |

All elements use props/styles interpreted by the Takumi renderer, not by a browser layout engine.

## No Animated GIF/Video

Stream Deck hardware does not support animated images. Each `setImage` call is a static frame. Animation is achieved through rapid `setImage` calls via `useTick`, limited by render throughput.

## Performance

- Fast repeated updates still trigger real image renders.
- Dial rotation can emit many events in a short burst -- keep high-frequency UIs visually simple.
- `renderDebounceMs` (default: 16ms) coalesces heavy update bursts.
- Output hash caching (`caching: true` by default) skips duplicate `setImage()` calls when the rendered image hasn't changed.
- Actual animation FPS is roughly 10-30fps depending on component complexity.

## One React Root Per Visible Instance

Each action instance gets its own isolated React root:

- **Cost**: memory scales linearly with visible action count; no shared React state between roots by default.
- **Benefit**: complete isolation, no cross-instance bugs, clean lifecycle.

Use external state managers (Zustand, Jotai) or the wrapper API to share state across roots.

## Font Bundle Size

Fonts are loaded into the plugin runtime. Each font weight/style is a separate file:
- Latin-only subset: ~50-300KB
- CJK character sets: ~1-5MB

Minimize font variants to reduce bundle size and startup cost.

## No Interactivity Within Render

The rendered image is static -- there are no clickable regions within a key image. All interaction comes through hardware events (key press, dial rotate, touch tap). This is a Stream Deck hardware limitation.

## Render Batching

Multiple state updates within a single event handler are batched by React's automatic batching. The library adds:

1. **Microtask scheduling**: after `resetAfterCommit`, a microtask is queued rather than rendering immediately. Multiple commits in the same tick produce only one render pass.
2. **Configurable debounce**: `renderDebounceMs` (default 16ms, ~60fps ceiling) coalesces renders for high-frequency events.
