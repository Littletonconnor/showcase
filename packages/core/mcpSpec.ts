// The single MCP schema source both transports import (stdio in
// packages/mcp/server.ts, streamable HTTP in packages/server/mcpHttp.ts).
// Split by concern under mcpSpec/ — part schemas, surface/review/preset/learn
// tools, validation, resources, prompts — and re-assembled here so the
// "one schema source for both transports" guarantee is structural: everything
// still flows through this barrel.
import {
  HTTP_LEARN_TOOLS,
  LEARN_TOOL_DESCRIPTIONS,
  STDIO_LEARN_INPUT_SCHEMAS,
} from "./mcpSpec/learnTools.ts";
import {
  HTTP_PRESET_TOOLS,
  PRESET_TOOL_DESCRIPTIONS,
  STDIO_PRESET_INPUT_SCHEMAS,
} from "./mcpSpec/presetTools.ts";
import {
  HTTP_REVIEW_TOOLS,
  REVIEW_TOOL_DESCRIPTIONS,
  STDIO_REVIEW_INPUT_SCHEMAS,
} from "./mcpSpec/reviewTools.ts";
import {
  HTTP_SURFACE_TOOLS,
  STDIO_SURFACE_INPUT_SCHEMAS,
  SURFACE_TOOL_DESCRIPTIONS,
} from "./mcpSpec/surfaceTools.ts";

export { FEEDBACK_REPLY_NOTE, MCP_INSTRUCTIONS, MCP_SERVER_INFO } from "./mcpSpec/instructions.ts";
export { formatZodIssues, HTTP_MCP_TOOL_SCHEMAS, validateToolInput } from "./mcpSpec/validation.ts";
export {
  ASSET_RESOURCE_TEMPLATE,
  ASSET_RESOURCE_URI,
  parseAssetUri,
  parseSessionUri,
  parseSurfaceUri,
  SESSION_RESOURCE_TEMPLATE,
  SESSION_RESOURCE_URI,
  SURFACE_RESOURCE_TEMPLATE,
  SURFACE_RESOURCE_URI,
} from "./mcpSpec/resources.ts";
export { MCP_PROMPT_DEFS, promptMessages } from "./mcpSpec/prompts.ts";

export const MCP_TOOL_DESCRIPTIONS = {
  ...SURFACE_TOOL_DESCRIPTIONS,
  ...REVIEW_TOOL_DESCRIPTIONS,
  ...PRESET_TOOL_DESCRIPTIONS,
  ...LEARN_TOOL_DESCRIPTIONS,
} as const;

export const HTTP_MCP_TOOLS = [
  ...HTTP_SURFACE_TOOLS,
  ...HTTP_REVIEW_TOOLS,
  ...HTTP_PRESET_TOOLS,
  ...HTTP_LEARN_TOOLS,
] as const;

export const STDIO_MCP_INPUT_SCHEMAS = {
  ...STDIO_SURFACE_INPUT_SCHEMAS,
  ...STDIO_REVIEW_INPUT_SCHEMAS,
  ...STDIO_PRESET_INPUT_SCHEMAS,
  ...STDIO_LEARN_INPUT_SCHEMAS,
} as const;
