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
