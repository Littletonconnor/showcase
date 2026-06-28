// Zod schemas for the local config a user/repo authors under `<dir>/{themes,
// kits,blueprints}/*.json` + `<dir>/config.json` (docs/themable-explainers.md).
// ONE source of truth, used in two places: `userConfig.ts` gates what loads at
// boot (warn + skip on a miss), and `POST /api/config/validate` / `showcase
// validate` reports the same issues up front, so an author learns *what* is
// wrong instead of finding their theme silently absent. Runtime-agnostic (no
// `node:` imports) so both the server endpoint and core share it.
import { z } from "zod";

// CSS named colors (CSS Color 4) + the keywords valid in a color slot, so a
// palette using "tomato" or "transparent" isn't flagged. Lowercased lookup.
const CSS_KEYWORDS = new Set(
  (
    "transparent currentcolor inherit initial unset revert " +
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond " +
    "blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue " +
    "cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey " +
    "darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon " +
    "darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet " +
    "deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen " +
    "fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew " +
    "hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon " +
    "lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey " +
    "lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey " +
    "lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine " +
    "mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen " +
    "mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite " +
    "navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen " +
    "paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple " +
    "rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell " +
    "sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan " +
    "teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
  ).split(" "),
);

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
// Functional color notations + var() (a palette may reference a CSS custom
// property). The args aren't parsed — the goal is to reject obvious garbage
// ("blue-ish", an empty string), not to be a full CSS color parser.
const COLOR_FN = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|var)\(.*\)$/i;

function isCssColor(value: string): boolean {
  const s = value.trim();
  return HEX.test(s) || COLOR_FN.test(s) || CSS_KEYWORDS.has(s.toLowerCase());
}

const cssColor = z
  .string()
  .refine(isCssColor, "must be a CSS color (hex, rgb()/hsl()/oklch()/…, var(), or a named color)");

// Palette/accent are `.strict()`: a misspelled slot ("colour", "boder") is the
// failure mode that otherwise renders as a silent empty CSS var, so flagging the
// unknown key IS the value. Top-level theme/kit/blueprint stay lenient on extra
// keys (forward-compatible metadata), validating the declared fields' types.
const accent = z.object({ bg: cssColor, text: cssColor, border: cssColor }).strict();

const palette = z
  .object({
    bg: cssColor,
    panel: cssColor,
    surface: cssColor,
    text: cssColor,
    muted: cssColor,
    faint: cssColor,
    border: cssColor,
    border2: cssColor,
    hover: cssColor,
    info: accent,
    success: accent,
    warning: accent,
    danger: accent,
  })
  .strict();

export const themeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  // Shiki theme names default to github-light/dark in userConfig when omitted.
  shiki: z.object({ light: z.string(), dark: z.string() }).partial().optional(),
  light: palette,
  dark: palette,
});

export const kitSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  summary: z.string().optional(),
  classes: z.string().optional(),
  css: z.string().min(1),
  js: z.string().optional(),
});

const badge = z
  .object({
    tone: z.enum(["critical", "warning", "info", "success", "neutral"]),
    label: z.string().min(1),
  })
  .strict();

const blueprintSection = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    hint: z.string().optional(),
    required: z.boolean().optional(),
  })
  .strict();

export const blueprintSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  summary: z.string().min(1),
  extends: z.string().optional(),
  theme: z.string().optional(),
  kits: z.array(z.string()).optional(),
  structure: z.array(blueprintSection).optional(),
  brand: z
    .object({
      logoAssetId: z.string().optional(),
      wordmark: z.string().optional(),
      fontFamily: z.string().optional(),
    })
    .strict()
    .optional(),
  defaults: z.object({ badge: badge.optional() }).strict().optional(),
});

export const boardConfigSchema = z
  .object({
    defaultBlueprint: z.string().optional(),
    defaultTheme: z.string().optional(),
  })
  .strict();

export type ConfigKind = "theme" | "kit" | "blueprint" | "config";

const SCHEMAS = {
  theme: themeSchema,
  kit: kitSchema,
  blueprint: blueprintSchema,
  config: boardConfigSchema,
} satisfies Record<ConfigKind, z.ZodTypeAny>;

export const CONFIG_KINDS = Object.keys(SCHEMAS) as ConfigKind[];

export interface ConfigIssue {
  // Dotted path to the offending field ("dark.info.border"); "" for a root issue.
  path: string;
  message: string;
}

export type ConfigValidation = { ok: true } | { ok: false; issues: ConfigIssue[] };

// Validate one parsed config object against its kind's schema, flattening zod's
// error tree into a list of {path, message} an author can act on directly.
export function validateConfig(kind: ConfigKind, raw: unknown): ConfigValidation {
  const result = SCHEMAS[kind].safeParse(raw);
  if (result.success) return { ok: true };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}
