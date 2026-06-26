// base64 -> bytes via the `atob` platform global (no `node:` import, per the
// runtime-agnostic invariant). atob throws on malformed input; rethrow as a
// clean error so callers turn it into a 400 instead of a raw DOMException 500.
export function decodeBase64(b64: string): Uint8Array {
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new Error("invalid base64 in `data`");
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// bytes -> base64 via the `btoa` platform global (the encode mirror of the
// above). Chunked so a large blob can't blow String.fromCharCode's argument
// limit. Used by the static-export builder to inline assets as data URIs.
export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
