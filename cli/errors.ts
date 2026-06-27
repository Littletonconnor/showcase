// One place that turns failures into a one-line `showcase: …` message and a
// non-zero exit. Every command and the shared HTTP client route user-facing
// errors through here, so exit-code and message style stay consistent.

export function fail(msg: string): never {
  console.error(`showcase: ${msg}`);
  process.exit(1);
}

// Network/system error codes a fetch can surface, mapped to a human hint. The
// CLI mostly talks to its own local server, so a refused connection is the
// common case; the rest round out the map for a remote SHOWCASE_URL.
const FRIENDLY_ERRORS: Record<string, string> = {
  ECONNREFUSED: "connection refused — is the server running? Start it with: showcase serve",
  ECONNRESET: "the connection was reset by the server",
  ETIMEDOUT: "the connection timed out — the server took too long to respond",
  ENOTFOUND: "DNS lookup failed — check the host in SHOWCASE_URL for typos",
  EHOSTUNREACH: "host unreachable — check your network connection",
  ENETUNREACH: "network unreachable — check your internet connection",
  CERT_HAS_EXPIRED: "the server's SSL certificate has expired",
  DEPTH_ZERO_SELF_SIGNED_CERT: "the server uses a self-signed (untrusted) SSL certificate",
};

// A fetch rejection carries the OS code on `error.cause.code`. Returns a
// friendly message for a known code, or null to let the caller fall back.
export function friendlyNetworkError(error: unknown): string | null {
  const code =
    error && typeof error === "object" && "cause" in error
      ? (error as { cause?: { code?: string } }).cause?.code
      : (error as { code?: string } | null)?.code;
  return code ? (FRIENDLY_ERRORS[code] ?? null) : null;
}

// The closest known name (flag or command) to a mistyped one, or null when
// nothing is close enough — powers "did you mean …?" hints. `prefix` is the
// decoration to put back on the suggestion (e.g. "--" for flags, "" for
// commands).
export function suggest(unknown: string, known: string[], prefix = ""): string | null {
  const needle = unknown.replace(/^-+/, "");
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of known) {
    const d = levenshtein(needle, candidate);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  const maxDistance = Math.max(2, Math.floor(needle.length * 0.4));
  return best && bestDistance <= maxDistance ? `${prefix}${best}` : null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
