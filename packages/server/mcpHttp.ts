import type { Hono } from "hono";
import { type CommentWait, type Feedback } from "./app.ts";
import { decodeBase64, encodeBase64 } from "@showcase/core/base64";
import {
  type Asset,
  type AssetKind,
  type Comment,
  htmlPart,
  isAssetKind,
  type Session,
  type Store,
  type Surface,
  type SurfaceBadge,
  type SurfacePart,
} from "@showcase/core/types";
import { blueprintById } from "@showcase/core/blueprints";
import {
  ASSET_RESOURCE_TEMPLATE,
  ASSET_RESOURCE_URI,
  FEEDBACK_REPLY_NOTE,
  HTTP_MCP_TOOLS,
  MCP_INSTRUCTIONS,
  MCP_PROMPT_DEFS,
  MCP_SERVER_INFO,
  parseAssetUri,
  parseSessionUri,
  parseSurfaceUri,
  promptMessages,
  SESSION_RESOURCE_TEMPLATE,
  SESSION_RESOURCE_URI,
  SURFACE_RESOURCE_TEMPLATE,
  SURFACE_RESOURCE_URI,
  validateToolInput,
} from "@showcase/core/mcpSpec";
import { coerceSurfaceBadge, coerceSurfaceParts } from "@showcase/core/surfaceParts";

// Stateless MCP over streamable HTTP: every request is self-contained, so no
// per-connection server state is held. Session continuity is explicit —
// publish_surface returns a sessionId the agent passes back on later calls.

type FlowResult<T> = Promise<
  { surface: T; userFeedback?: Feedback[] } | { error: string; status: number }
>;

export interface McpDeps {
  store: Store;
  basePath?: (request: Request) => string;
  publishSurface(input: {
    parts: SurfacePart[];
    title?: string;
    badge?: SurfaceBadge;
    theme?: string;
    blueprint?: string;
    session?: string;
    sessionTitle?: string;
    agent?: string;
  }): FlowResult<Surface>;
  publishDecisions(input: {
    brief?: string;
    verdict?: string;
    decisions?: unknown;
    manifest?: unknown;
    session?: string;
    sessionTitle?: string;
    agent?: string;
  }): Promise<
    | { sessionId: string; decisions: number; briefWarning?: string; warnings?: string[] }
    | { error: string; status: number }
  >;
  publishPreset(input: {
    preset: string;
    data: unknown;
    session?: string;
    sessionTitle?: string;
    agent?: string;
  }): FlowResult<Surface>;
  publishLesson(input: {
    lesson: unknown;
    session?: string;
    sessionTitle?: string;
    agent?: string;
  }): Promise<
    | {
        sessionId: string;
        syllabusId: string;
        beats: { surfaceId: string; conceptId: string }[];
        userFeedback?: Feedback[];
      }
    | { error: string; status: number }
  >;
  updateLessonBeat(input: {
    surfaceId?: string;
    session?: string;
    beat: unknown;
    title?: string;
  }): FlowResult<Surface>;
  gradeAttempt(input: {
    topic?: string;
    session?: string;
    conceptId?: string;
    kind?: string;
    correct?: unknown;
    misconception?: string;
  }): Promise<{ record: unknown } | { error: string; status: number }>;
  learnerState(input: { topic?: string }): Promise<{ topics: unknown[]; due: unknown[] }>;
  reviseSurface(
    id: string,
    patch: {
      parts?: SurfacePart[];
      title?: string;
      badge?: SurfaceBadge | null;
      theme?: string | null;
      blueprint?: string | null;
    },
  ): FlowResult<Surface>;
  deleteSurface(id: string): Promise<{ surface: Surface } | { error: string; status: number }>;
  configureSession(
    sessionId: string,
    preset: { blueprint?: string | null; theme?: string | null },
  ): Promise<{ session: Session } | { error: string; status: number }>;
  createComment(input: {
    text: string;
    surface?: string;
    session?: string;
    author: string;
  }): Promise<{ comment: Comment; userFeedback?: Feedback[] } | { error: string; status: number }>;
  waitForComments(q: CommentWait): Promise<{ comments: Comment[]; lastSeq: number }>;
  uploadAsset(input: {
    data: Uint8Array;
    contentType: string;
    filename?: string;
    kind?: AssetKind;
    session?: string;
  }): Promise<{ asset: Omit<Asset, "data"> } | { error: string; status: number }>;
  guide: string;
}

// Tailored preset tools → their blueprint id (the renderer + theme + kits).
const TOOL_TO_PRESET: Record<string, string> = {
  publish_postmortem: "postmortem",
  publish_dashboard: "data-viz",
  publish_design_doc: "design-doc",
  publish_status: "status",
  publish_architecture: "architecture",
  publish_product_demo: "product-demo",
  publish_product_direction: "wealthfront-product",
};

export function registerMcp(app: Hono, deps: McpDeps) {
  const surfaceResult = (result: { surface: Surface; userFeedback?: Feedback[] }, origin: string) =>
    JSON.stringify(
      {
        id: result.surface.id,
        sessionId: result.surface.sessionId,
        version: result.surface.version,
        url: `${origin}/session/${result.surface.sessionId}/s/${result.surface.id}`,
        ...(result.userFeedback && { userFeedback: result.userFeedback }),
      },
      null,
      2,
    );

  // The full read-back view of a surface, shared by the get_surface tool and the
  // resources/read handler — every current part plus its metadata and view URL.
  const surfaceReadView = (s: Surface, origin: string) => ({
    id: s.id,
    sessionId: s.sessionId,
    title: s.title,
    version: s.version,
    updatedAt: s.updatedAt,
    ...(s.badge ? { badge: s.badge } : {}),
    ...(s.theme ? { theme: s.theme } : {}),
    ...(s.blueprint ? { blueprint: s.blueprint } : {}),
    parts: s.parts,
    url: `${origin}/session/${s.sessionId}/s/${s.id}`,
  });

  // showcase://surface/<id> → an MCP resource descriptor for resources/list.
  const surfaceResource = (s: Surface) => ({
    uri: `${SURFACE_RESOURCE_URI}${s.id}`,
    name: s.title,
    description: `${s.parts.map((p) => p.kind).join(", ")} · v${s.version} · session ${s.sessionId}`,
    mimeType: "application/json",
  });

  // showcase://session/<id> → the session and its surface index (ids/titles/kinds),
  // so a client can browse the board's structure, not just individual surfaces.
  const sessionResource = (s: Session, surfaceCount: number) => ({
    uri: `${SESSION_RESOURCE_URI}${s.id}`,
    name: s.title ?? s.id,
    description: `${surfaceCount} surface${surfaceCount === 1 ? "" : "s"} · ${s.agent}`,
    mimeType: "application/json",
  });
  const sessionReadView = (s: Session, surfaces: Surface[], origin: string) => ({
    id: s.id,
    title: s.title,
    agent: s.agent,
    createdAt: s.createdAt,
    lastActiveAt: s.lastActiveAt,
    ...(s.blueprint ? { blueprint: s.blueprint } : {}),
    ...(s.theme ? { theme: s.theme } : {}),
    url: `${origin}/session/${s.id}`,
    surfaces: surfaces.map((su) => ({
      id: su.id,
      title: su.title,
      kinds: su.parts.map((p) => p.kind),
      version: su.version,
    })),
  });

  // showcase://asset/<id> → an uploaded asset. The descriptor carries the type/
  // size; resources/read returns the bytes as a base64 `blob` (the protocol-
  // native way to attach an image/file), addressable at <origin>/a/<id>.
  const assetResource = (a: { id: string; contentType: string; byteLength: number }) => ({
    uri: `${ASSET_RESOURCE_URI}${a.id}`,
    name: a.id,
    description: `${a.contentType} · ${a.byteLength} bytes`,
    mimeType: a.contentType,
  });
  // Assets list per session; without a scope, gather across every session.
  const listAllAssets = async (sessionId?: string) => {
    if (sessionId) return deps.store.listAssets(sessionId);
    const sessions = await deps.store.listSessions();
    const groups = await Promise.all(sessions.map((s) => deps.store.listAssets(s.id)));
    return groups.flat();
  };

  async function callTool(name: string, args: any, origin: string): Promise<string> {
    switch (name) {
      case "publish_surface":
      case "publish_snippet": {
        const parts =
          name === "publish_snippet"
            ? coerceSurfaceParts([htmlPart(String(args.html ?? ""), args.kits)])
            : coerceSurfaceParts(args.parts);
        if (parts.length === 0) throw new Error("a surface needs at least one part");
        const result = await deps.publishSurface({
          parts,
          title: typeof args.title === "string" ? args.title : undefined,
          badge: coerceSurfaceBadge(args.badge) ?? undefined,
          theme: typeof args.theme === "string" ? args.theme : undefined,
          blueprint: typeof args.blueprint === "string" ? args.blueprint : undefined,
          session: typeof args.session === "string" ? args.session : undefined,
          sessionTitle: typeof args.sessionTitle === "string" ? args.sessionTitle : undefined,
          agent: typeof args.agent === "string" ? args.agent : undefined,
        });
        if ("error" in result) throw new Error(result.error);
        return surfaceResult(result, origin);
      }
      case "publish_decisions": {
        const str = (v: unknown) => (typeof v === "string" ? v : undefined);
        const result = await deps.publishDecisions({
          brief: str(args.brief),
          verdict: str(args.verdict),
          decisions: args.decisions,
          manifest: args.manifest,
          session: str(args.session),
          sessionTitle: str(args.sessionTitle),
          agent: str(args.agent),
        });
        if ("error" in result) throw new Error(result.error);
        return JSON.stringify(
          {
            sessionId: result.sessionId,
            decisions: result.decisions,
            url: `${origin}/?review=${result.sessionId}`,
            ...(result.briefWarning ? { briefWarning: result.briefWarning } : {}),
            ...(result.warnings && result.warnings.length > 0 ? { warnings: result.warnings } : {}),
          },
          null,
          2,
        );
      }
      case "update_surface":
      case "update_snippet": {
        const patch: {
          parts?: SurfacePart[];
          title?: string;
          badge?: SurfaceBadge | null;
          theme?: string | null;
          blueprint?: string | null;
        } = {
          title: typeof args.title === "string" ? args.title : undefined,
          ...("badge" in args ? { badge: coerceSurfaceBadge(args.badge) } : {}),
          ...("theme" in args
            ? {
                theme:
                  args.theme === null
                    ? null
                    : typeof args.theme === "string"
                      ? args.theme
                      : undefined,
              }
            : {}),
          ...("blueprint" in args
            ? {
                blueprint:
                  args.blueprint === null
                    ? null
                    : typeof args.blueprint === "string"
                      ? args.blueprint
                      : undefined,
              }
            : {}),
        };
        if (name === "update_snippet") {
          if (typeof args.html === "string")
            patch.parts = coerceSurfaceParts([htmlPart(args.html, args.kits)]);
        } else if (args.parts !== undefined) {
          patch.parts = coerceSurfaceParts(args.parts);
        }
        const result = await deps.reviseSurface(String(args.id ?? ""), patch);
        if ("error" in result) throw new Error(result.error);
        return surfaceResult(result, origin);
      }
      case "delete_surface": {
        const result = await deps.deleteSurface(String(args.id ?? ""));
        if ("error" in result) throw new Error(result.error);
        return JSON.stringify(
          { ok: true, id: result.surface.id, sessionId: result.surface.sessionId },
          null,
          2,
        );
      }
      case "wait_for_feedback": {
        const result = await deps.waitForComments({
          sessionId: String(args.session ?? ""),
          author: "user",
          afterSeq: typeof args.afterSeq === "number" ? args.afterSeq : undefined,
          waitSeconds: typeof args.timeoutSeconds === "number" ? args.timeoutSeconds : 60,
        });
        if (result.comments.length === 0) {
          return JSON.stringify({
            comments: [],
            lastSeq: result.lastSeq,
            note: "no user feedback yet — continue, or wait again later",
          });
        }
        return JSON.stringify(
          {
            comments: result.comments.map((c) => ({
              surfaceId: c.surfaceId,
              surfaceTitle: c.surfaceTitle,
              text: c.text,
              at: c.createdAt,
            })),
            lastSeq: result.lastSeq,
            note: FEEDBACK_REPLY_NOTE,
          },
          null,
          2,
        );
      }
      case "list_surfaces": {
        const surfaces = await deps.store.listSurfaces(
          typeof args.session === "string" ? args.session : undefined,
        );
        return JSON.stringify(
          surfaces.map((s) => ({
            id: s.id,
            sessionId: s.sessionId,
            title: s.title,
            kinds: s.parts.map((p) => p.kind),
            version: s.version,
            updatedAt: s.updatedAt,
          })),
          null,
          2,
        );
      }
      case "get_surface": {
        const surface = await deps.store.getSurface(String(args.id ?? ""));
        if (!surface) throw new Error(`no surface ${args.id ?? ""}`);
        return JSON.stringify(surfaceReadView(surface, origin), null, 2);
      }
      case "upload_asset": {
        if (typeof args.data !== "string" || args.data.length === 0) {
          throw new Error("upload_asset needs base64 `data`");
        }
        const result = await deps.uploadAsset({
          data: decodeBase64(args.data),
          contentType: typeof args.contentType === "string" ? args.contentType : "",
          filename: typeof args.filename === "string" ? args.filename : undefined,
          kind: isAssetKind(args.kind) ? args.kind : undefined,
          session: typeof args.session === "string" ? args.session : undefined,
        });
        if ("error" in result) throw new Error(result.error);
        return JSON.stringify(
          {
            id: result.asset.id,
            sessionId: result.asset.sessionId,
            url: `${origin}/a/${result.asset.id}`,
            contentType: result.asset.contentType,
            byteLength: result.asset.byteLength,
            kind: result.asset.kind,
          },
          null,
          2,
        );
      }
      case "publish_postmortem":
      case "publish_dashboard":
      case "publish_design_doc":
      case "publish_status":
      case "publish_architecture":
      case "publish_product_demo":
      case "publish_product_direction": {
        const preset = TOOL_TO_PRESET[name];
        const result = await deps.publishPreset({
          preset,
          data: args,
          session: typeof args.session === "string" ? args.session : undefined,
          sessionTitle: typeof args.sessionTitle === "string" ? args.sessionTitle : undefined,
          agent: typeof args.agent === "string" ? args.agent : undefined,
        });
        if ("error" in result) throw new Error(result.error);
        return surfaceResult(result, origin);
      }
      case "publish_lesson": {
        const result = await deps.publishLesson({
          lesson: args,
          session: typeof args.session === "string" ? args.session : undefined,
          sessionTitle: typeof args.sessionTitle === "string" ? args.sessionTitle : undefined,
          agent: typeof args.agent === "string" ? args.agent : undefined,
        });
        if ("error" in result) throw new Error(result.error);
        return JSON.stringify(
          {
            sessionId: result.sessionId,
            syllabusId: result.syllabusId,
            beats: result.beats,
            url: `${origin}/session/${result.sessionId}`,
            note: "Now call wait_for_feedback: checkpoint attempts arrive as [checkpoint] lines. Grade free-text answers with record_attempt and reply; on a misconception-tagged miss, remediate with update_lesson.",
            ...(result.userFeedback && { userFeedback: result.userFeedback }),
          },
          null,
          2,
        );
      }
      case "update_lesson": {
        const result = await deps.updateLessonBeat({
          surfaceId: typeof args.surfaceId === "string" ? args.surfaceId : undefined,
          session: typeof args.session === "string" ? args.session : undefined,
          beat: args.beat,
          title: typeof args.title === "string" ? args.title : undefined,
        });
        if ("error" in result) throw new Error(result.error);
        return surfaceResult(result, origin);
      }
      case "record_attempt": {
        const result = await deps.gradeAttempt({
          topic: typeof args.topic === "string" ? args.topic : undefined,
          session: typeof args.session === "string" ? args.session : undefined,
          conceptId: typeof args.conceptId === "string" ? args.conceptId : undefined,
          kind: typeof args.kind === "string" ? args.kind : undefined,
          correct: args.correct,
          misconception: typeof args.misconception === "string" ? args.misconception : undefined,
        });
        if ("error" in result) throw new Error(result.error);
        return JSON.stringify(result, null, 2);
      }
      case "get_learner_state": {
        const state = await deps.learnerState({
          topic: typeof args.topic === "string" ? args.topic : undefined,
        });
        return JSON.stringify(state, null, 2);
      }
      case "configure_session": {
        const presetField = (v: unknown): string | null | undefined =>
          v === null ? null : typeof v === "string" ? v : undefined;
        const result = await deps.configureSession(String(args.session ?? ""), {
          blueprint: "blueprint" in args ? presetField(args.blueprint) : undefined,
          theme: "theme" in args ? presetField(args.theme) : undefined,
        });
        if ("error" in result) throw new Error(result.error);
        const bp = blueprintById(result.session.blueprint);
        return JSON.stringify(
          {
            sessionId: result.session.id,
            blueprint: result.session.blueprint ?? null,
            theme: result.session.theme ?? null,
            structure: bp?.structure ?? [],
            note: bp
              ? `Every surface published to this session now defaults to the "${bp.label}" preset (${bp.summary}). Author each surface to follow its structure in order, tagging each section data-section="<id>", so the session stays consistent no matter what is asked.`
              : "Session preset updated.",
          },
          null,
          2,
        );
      }
      case "get_design_guide":
        return deps.guide;
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  }

  app.post("/mcp", async (c) => {
    const rpc = (id: unknown, result: unknown) => c.json({ jsonrpc: "2.0", id, result });
    const rpcError = (id: unknown, code: number, message: string, status = 200) =>
      c.json({ jsonrpc: "2.0", id, error: { code, message } }, status as 200);

    let msg: any;
    try {
      msg = await c.req.json();
    } catch {
      return rpcError(null, -32700, "parse error", 400);
    }
    if (Array.isArray(msg)) {
      return rpcError(null, -32600, "batch requests are not supported", 400);
    }

    if (msg.method === "initialize") {
      return rpc(msg.id, {
        protocolVersion:
          typeof msg.params?.protocolVersion === "string"
            ? msg.params.protocolVersion
            : "2025-03-26",
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: MCP_SERVER_INFO,
        instructions: MCP_INSTRUCTIONS,
      });
    }
    if (msg.id === undefined) return c.body(null, 202); // notifications
    if (msg.method === "ping") return rpc(msg.id, {});
    if (msg.method === "tools/list") return rpc(msg.id, { tools: HTTP_MCP_TOOLS });
    if (msg.method === "resources/list") {
      const scope = typeof msg.params?.session === "string" ? msg.params.session : undefined;
      const [surfaces, sessions, assets] = await Promise.all([
        deps.store.listSurfaces(scope),
        deps.store.listSessions(),
        listAllAssets(scope),
      ]);
      const counts = new Map<string, number>();
      for (const s of surfaces) counts.set(s.sessionId, (counts.get(s.sessionId) ?? 0) + 1);
      const sessionRows = (scope ? sessions.filter((s) => s.id === scope) : sessions).map((s) =>
        sessionResource(s, counts.get(s.id) ?? 0),
      );
      return rpc(msg.id, {
        resources: [...surfaces.map(surfaceResource), ...sessionRows, ...assets.map(assetResource)],
      });
    }
    if (msg.method === "resources/templates/list") {
      return rpc(msg.id, {
        resourceTemplates: [
          {
            uriTemplate: SURFACE_RESOURCE_TEMPLATE,
            name: "showcase surface",
            description: "A published surface's full current content, by id",
            mimeType: "application/json",
          },
          {
            uriTemplate: SESSION_RESOURCE_TEMPLATE,
            name: "showcase session",
            description: "A session's metadata and its surface index, by id",
            mimeType: "application/json",
          },
          {
            uriTemplate: ASSET_RESOURCE_TEMPLATE,
            name: "showcase asset",
            description: "An uploaded asset's bytes, by id",
          },
        ],
      });
    }
    if (msg.method === "resources/read") {
      const uri = String(msg.params?.uri ?? "");
      const url = new URL(c.req.url);
      const origin = `${url.origin}${deps.basePath?.(c.req.raw) ?? ""}`;
      const json = (text: string) =>
        rpc(msg.id, { contents: [{ uri, mimeType: "application/json", text }] });

      const surfaceId = parseSurfaceUri(uri);
      if (surfaceId) {
        const surface = await deps.store.getSurface(surfaceId);
        if (!surface) return rpcError(msg.id, -32602, `no surface ${surfaceId}`);
        return json(JSON.stringify(surfaceReadView(surface, origin), null, 2));
      }
      const sessionId = parseSessionUri(uri);
      if (sessionId) {
        const session = await deps.store.getSession(sessionId);
        if (!session) return rpcError(msg.id, -32602, `no session ${sessionId}`);
        const surfaces = await deps.store.listSurfaces(sessionId);
        return json(JSON.stringify(sessionReadView(session, surfaces, origin), null, 2));
      }
      const assetId = parseAssetUri(uri);
      if (assetId) {
        const asset = await deps.store.getAsset(assetId);
        if (!asset) return rpcError(msg.id, -32602, `no asset ${assetId}`);
        return rpc(msg.id, {
          contents: [{ uri, mimeType: asset.contentType, blob: encodeBase64(asset.data) }],
        });
      }
      return rpcError(msg.id, -32602, `unsupported resource uri: ${uri}`);
    }
    if (msg.method === "prompts/list") return rpc(msg.id, { prompts: MCP_PROMPT_DEFS });
    if (msg.method === "prompts/get") {
      const built = promptMessages(String(msg.params?.name ?? ""), msg.params?.arguments ?? {});
      if (!built) return rpcError(msg.id, -32602, `unknown prompt: ${msg.params?.name}`);
      return rpc(msg.id, built);
    }
    if (msg.method === "tools/call") {
      const name = msg.params?.name;
      const args = msg.params?.arguments ?? {};
      // Validate against the tool's zod schema before dispatch, so bad input is a
      // structured -32602 with the exact field issues — not a stringly-typed
      // failure deep in a flow. (The stdio transport gets this from the SDK.)
      const check =
        typeof name === "string" ? validateToolInput(name, args) : { ok: true as const };
      if (!check.ok) {
        return rpcError(msg.id, -32602, `invalid arguments for ${name}: ${check.error}`);
      }
      const url = new URL(c.req.url);
      const baseUrl = `${url.origin}${deps.basePath?.(c.req.raw) ?? ""}`;
      try {
        const text = await callTool(name, args, baseUrl);
        return rpc(msg.id, { content: [{ type: "text", text }] });
      } catch (err) {
        return rpc(msg.id, {
          content: [{ type: "text", text: `error: ${err instanceof Error ? err.message : err}` }],
          isError: true,
        });
      }
    }
    return rpcError(msg.id, -32601, `method not found: ${msg.method}`);
  });

  // Stateless server: no SSE stream to resume, no session to delete.
  app.get("/mcp", (c) => c.text("showcase MCP is stateless — POST JSON-RPC messages here", 405));
  app.delete("/mcp", (c) => c.body(null, 405));
}
