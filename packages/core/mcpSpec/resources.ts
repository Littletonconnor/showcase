// MCP resources + prompts — the protocol-native read-back/recipe layer, shared
// by both transports (HTTP in mcpHttp.ts, stdio in mcp/server.ts). Resources let
// a client browse/attach published surfaces; prompts expose the flagship recipes
// (review, explainer) as ready-to-run templates.
export const SURFACE_RESOURCE_URI = "showcase://surface/";
export const SURFACE_RESOURCE_TEMPLATE = `${SURFACE_RESOURCE_URI}{id}`;
export const SESSION_RESOURCE_URI = "showcase://session/";
export const SESSION_RESOURCE_TEMPLATE = `${SESSION_RESOURCE_URI}{id}`;
export const ASSET_RESOURCE_URI = "showcase://asset/";
export const ASSET_RESOURCE_TEMPLATE = `${ASSET_RESOURCE_URI}{id}`;

// Parse the id out of a showcase://<prefix>/<id> uri (null if the prefix doesn't
// match or the id is empty). One parser per kind keeps the call sites readable.
function parseResourceUri(prefix: string, uri: string): string | null {
  if (!uri.startsWith(prefix)) return null;
  const id = uri.slice(prefix.length).trim();
  return id.length > 0 ? id : null;
}
export const parseSurfaceUri = (uri: string): string | null =>
  parseResourceUri(SURFACE_RESOURCE_URI, uri);
export const parseSessionUri = (uri: string): string | null =>
  parseResourceUri(SESSION_RESOURCE_URI, uri);
export const parseAssetUri = (uri: string): string | null =>
  parseResourceUri(ASSET_RESOURCE_URI, uri);
