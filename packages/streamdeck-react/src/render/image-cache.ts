// ── LRU Image Cache ─────────────────────────────────────────────────
//
// Byte-size-bounded LRU cache for rendered images and raw buffers.
//
// Why byte-bounded (not count-bounded):
//   Stream Deck images vary wildly in size — a 72×72 key PNG is ~2KB,
//   a 144×144 key PNG is ~8KB, and an 800×100 raw RGBA TouchStrip buffer
//   is 320KB.  A count-bounded cache would either waste memory on small
//   images or evict too aggressively for large ones.
//
// Data structure:
//   ┌──────────────────────────────────────────────┐
//   │  Map<hash, CacheEntry>   (O(1) lookup)       │
//   │                                              │
//   │  head ←→ entry ←→ entry ←→ ... ←→ tail      │
//   │  (MRU)   doubly-linked list       (LRU)      │
//   └──────────────────────────────────────────────┘
//
//   get()  → O(1) Map lookup + move-to-head
//   set()  → O(1) insert at head + evict from tail until under budget
//   evict  → O(1) unlink tail + Map.delete
//
// Generic over value type `V`:
//   ImageCache<string>  — data URI cache for keys/dials (Phase 2)
//   ImageCache<Buffer>  — raw RGBA cache for TouchStrip raw path (Phase 2)
//   ImageCache<Array<[number, string]>>  — segment URI cache for TouchStrip shared-strip path (Phase 2)
//
// Shared as singletons (one per cache type) across all ReactRoots so
// the global memory budget is enforced regardless of how many actions
// are active.

// ── Cache Entry (doubly-linked list node) ───────────────────────────

interface CacheEntry<V> {
  key: number;
  value: V;
  byteSize: number;
  prev: CacheEntry<V> | null;
  next: CacheEntry<V> | null;
}

// ── ImageCache ──────────────────────────────────────────────────────

export interface CacheStats {
  /** Number of entries currently in the cache. */
  entries: number;
  /** Current memory usage in bytes. */
  bytes: number;
  /** Maximum memory budget in bytes. */
  maxBytes: number;
  /** Total cache hits since creation or last reset. */
  hits: number;
  /** Total cache misses since creation or last reset. */
  misses: number;
}

/**
 * Byte-bounded LRU cache. Evicts least-recently-used entries when the
 * total byte size exceeds `maxBytes`.
 *
 * Generic over value type: use `string` for data URI caching (keys/dials),
 * `Buffer` for raw RGBA caching (TouchStrip).
 */
export class ImageCache<V = string> {
  private map = new Map<number, CacheEntry<V>>();
  private head: CacheEntry<V> | null = null; // most recently used
  private tail: CacheEntry<V> | null = null; // least recently used
  private currentBytes = 0;
  private _hits = 0;
  private _misses = 0;

  constructor(private maxBytes: number) {}

  /** Retrieve a cached value. Returns `undefined` on miss. Promotes to MRU on hit. */
  get(key: number): V | undefined {
    const entry = this.map.get(key);
    if (entry == null) {
      this._misses++;
      return undefined;
    }
    this._hits++;
    this.moveToHead(entry);
    return entry.value;
  }

  /** Insert or update a cache entry. Evicts LRU entries if over budget. */
  set(key: number, value: V, byteSize: number): void {
    const existing = this.map.get(key);
    if (existing != null) {
      // Update existing entry
      this.currentBytes -= existing.byteSize;
      existing.value = value;
      existing.byteSize = byteSize;
      this.currentBytes += byteSize;
      this.moveToHead(existing);
      this.evictUntilUnderBudget();
      return;
    }

    // Evict until there's room
    while (this.currentBytes + byteSize > this.maxBytes && this.tail != null) {
      this.evictTail();
    }

    // If a single entry exceeds the budget, don't cache it
    if (byteSize > this.maxBytes) return;

    const entry: CacheEntry<V> = {
      key,
      value,
      byteSize,
      prev: null,
      next: this.head,
    };

    if (this.head != null) {
      this.head.prev = entry;
    }
    this.head = entry;
    if (this.tail == null) {
      this.tail = entry;
    }

    this.map.set(key, entry);
    this.currentBytes += byteSize;
  }

  /** Clear all entries and reset stats. */
  clear(): void {
    this.map.clear();
    this.head = null;
    this.tail = null;
    this.currentBytes = 0;
    this._hits = 0;
    this._misses = 0;
  }

  /** Current cache statistics. */
  get stats(): CacheStats {
    return {
      entries: this.map.size,
      bytes: this.currentBytes,
      maxBytes: this.maxBytes,
      hits: this._hits,
      misses: this._misses,
    };
  }

  // ── Internal ────────────────────────────────────────────────────

  private moveToHead(entry: CacheEntry<V>): void {
    if (entry === this.head) return;

    // Unlink from current position
    if (entry.prev != null) entry.prev.next = entry.next;
    if (entry.next != null) entry.next.prev = entry.prev;
    if (entry === this.tail) this.tail = entry.prev;

    // Insert at head
    entry.prev = null;
    entry.next = this.head;
    if (this.head != null) this.head.prev = entry;
    this.head = entry;
  }

  private evictTail(): void {
    if (this.tail == null) return;
    const evicted = this.tail;
    this.tail = evicted.prev;
    if (this.tail != null) {
      this.tail.next = null;
    } else {
      this.head = null;
    }
    this.currentBytes -= evicted.byteSize;
    this.map.delete(evicted.key);
  }

  private evictUntilUnderBudget(): void {
    while (this.currentBytes > this.maxBytes && this.tail != null) {
      this.evictTail();
    }
  }
}

// ── Shared Cache Singletons ─────────────────────────────────────────
// Single shared cache across all ReactRoots (per user decision).

const DEFAULT_IMAGE_CACHE_MAX_BYTES = 16 * 1024 * 1024; // 16 MB
const DEFAULT_TOUCH_STRIP_CACHE_MAX_BYTES = 8 * 1024 * 1024; // 8 MB

/** Shared image cache for key/dial data URIs. */
let imageCache: ImageCache<string> | null = null;

/** Shared raw buffer cache for TouchStrip RGBA data. */
let touchStripCache: ImageCache<Buffer> | null = null;

/** Shared segment URI cache for TouchStrip shared-strip renders. */
let touchStripSegmentCache: ImageCache<Array<[number, string]>> | null = null;

/** Get or create the shared image cache for data URIs. */
export function getImageCache(maxBytes?: number): ImageCache<string> {
  if (imageCache == null) {
    imageCache = new ImageCache<string>(maxBytes ?? DEFAULT_IMAGE_CACHE_MAX_BYTES);
  }
  return imageCache;
}

/** Get or create the shared TouchStrip raw buffer cache. */
export function getTouchStripCache(maxBytes?: number): ImageCache<Buffer> {
  if (touchStripCache == null) {
    touchStripCache = new ImageCache<Buffer>(maxBytes ?? DEFAULT_TOUCH_STRIP_CACHE_MAX_BYTES);
  }
  return touchStripCache;
}

/**
 * Get or create the shared TouchStrip segment URI cache.
 * Stores sorted `[column, dataUri]` tuples per tree hash + column config.
 */
export function getTouchStripSegmentCache(maxBytes?: number): ImageCache<Array<[number, string]>> {
  if (touchStripSegmentCache == null) {
    touchStripSegmentCache = new ImageCache<Array<[number, string]>>(
      maxBytes ?? DEFAULT_TOUCH_STRIP_CACHE_MAX_BYTES,
    );
  }
  return touchStripSegmentCache;
}

function createEmptyStats(maxBytes: number): CacheStats {
  return {
    entries: 0,
    bytes: 0,
    maxBytes,
    hits: 0,
    misses: 0,
  };
}

export function getImageCacheStats(): CacheStats {
  return imageCache?.stats ?? createEmptyStats(DEFAULT_IMAGE_CACHE_MAX_BYTES);
}

export function getTouchStripCacheStats(): CacheStats {
  return touchStripCache?.stats ?? createEmptyStats(DEFAULT_TOUCH_STRIP_CACHE_MAX_BYTES);
}

export function getTouchStripSegmentCacheStats(): CacheStats {
  return touchStripSegmentCache?.stats ?? createEmptyStats(DEFAULT_TOUCH_STRIP_CACHE_MAX_BYTES);
}

/** Reset all caches (for testing or config changes). */
export function resetCaches(): void {
  imageCache?.clear();
  imageCache = null;
  touchStripCache?.clear();
  touchStripCache = null;
  touchStripSegmentCache?.clear();
  touchStripSegmentCache = null;
}
