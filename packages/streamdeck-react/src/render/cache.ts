// ── FNV-1a Hash ─────────────────────────────────────────────────────
// Fast, non-cryptographic hash for comparing render output.

export function fnv1a(input: string | Uint8Array | Buffer): number {
  let hash = 2166136261;

  if (typeof input === "string") {
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  } else {
    for (let i = 0; i < input.length; i++) {
      hash ^= input[i]!;
      hash = Math.imul(hash, 16777619);
    }
  }

  return hash >>> 0;
}
