type Key = string;

interface Bucket {
  count: number;
  resetAt: number; // epoch ms
}

export class SimpleRateLimiter {
  private buckets: Map<Key, Bucket> = new Map();

  constructor(private limit: number, private windowMs: number) {}

  private now() { return Date.now(); }

  private key(parts: Array<string | number | undefined | null>): Key {
    return parts.map(v => (v === undefined || v === null) ? '-' : String(v)).join('|');
  }

  allow(parts: Array<string | number | undefined | null>): { allowed: boolean; remaining: number; resetMs: number } {
    const k = this.key(parts);
    const current = this.now();
    const bucket = this.buckets.get(k);
    if (!bucket || bucket.resetAt <= current) {
      const resetAt = current + this.windowMs;
      this.buckets.set(k, { count: 1, resetAt });
      return { allowed: true, remaining: this.limit - 1, resetMs: resetAt - current };
    }
    if (bucket.count < this.limit) {
      bucket.count += 1;
      return { allowed: true, remaining: this.limit - bucket.count, resetMs: bucket.resetAt - current };
    }
    return { allowed: false, remaining: 0, resetMs: bucket.resetAt - current };
  }
}


