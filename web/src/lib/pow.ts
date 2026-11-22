/** The browser half of the signup proof of work: find a counter so SHA-256(`${salt}:${counter}`) starts with `bits` zero bits. */

interface Challenge {
  salt: string;
  bits: number;
  expires_at: number;
  signature: string;
}

const BATCH = 256;

export function leadingZeroBits(bytes: Uint8Array): number {
  let n = 0;
  for (const b of bytes) {
    if (b === 0) {
      n += 8;
      continue;
    }
    return n + Math.clz32(b) - 24;
  }
  return n;
}

/** Hashes in batches so the page stays responsive; each await hands the thread back to the browser. */
export async function findCounter(
  salt: string,
  bits: number,
  signal?: AbortSignal,
): Promise<number> {
  const enc = new TextEncoder();
  for (let base = 0; ; base += BATCH) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const hashes = await Promise.all(
      Array.from({ length: BATCH }, (_, i) =>
        crypto.subtle.digest("SHA-256", enc.encode(`${salt}:${base + i}`)),
      ),
    );
    for (const [i, h] of hashes.entries()) {
      if (leadingZeroBits(new Uint8Array(h)) >= bits) return base + i;
    }
  }
}

export const solveChallenge = (c: Challenge, signal?: AbortSignal) =>
  findCounter(c.salt, c.bits, signal);
