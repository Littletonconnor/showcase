import { z } from "zod";
import { d } from "./fieldDocs.ts";

export const PRESET_TOOL_DESCRIPTIONS = {
  publishPostmortem:
    "Publish a blameless incident POSTMORTEM as a structured surface — you supply typed fields, the server renders the fixed layout (so every postmortem looks the same). Pass: summary, impact{affected,experience,duration}, timeline[]{at,event}, fiveWhys[]{why,because} (the chain from the customer-visible failure to a SYSTEMIC cause), contributingFactors (the 'why didn't tests/monitoring catch it' note), fixes{immediate[],necessary[],additional[]}, wentWell/wentPainful, followups[]{item,owner,ticket,due,status}, and impactLevel/reoccurrence. Renders into a postmortem session.",
  publishDashboard:
    "Publish a metrics DASHBOARD (data-viz) as a structured surface. Pass: headline{value,label,delta}, stats[]{label,value}, bars{caption,data[]{label,value}}, trend{caption,values[]}, detail[]{label,value}, takeaway. The server renders the fixed dashboard layout (headline → breakdown chart → trend → detail → takeaway) so every dashboard reads the same.",
  publishDesignDoc:
    "Publish a DESIGN DOC / RFC as a structured surface following the detailed template. The GOAL must be a problem statement (no implementation leakage). Pass: status, meta{author,reviewers,links[]}, summary, goal{problem,metrics}, invariants{trueInvariants,preferences,assumptions}, background, solutionSpace{note,axes[]{axis,options[]{label,chosen},rationale}} (axes = independent technical decisions, candidates named by property), proposed{summary,failureModes,observability}, scope{inScope,outScope,milestones[]}, rollout, testing, openQuestions[]{question,owner}.",
  publishStatus:
    "Publish a recurring STATUS report as a structured surface. Pass: state (on-track|at-risk|off-track), headline, shipped[]{item,note}, inFlight[]{item,pct}, blockers, next[]. The server renders the fixed status layout so every weekly update reads identically.",
  publishArchitecture:
    "Publish a system ARCHITECTURE overview as a structured surface. Pass: components[]{name,role} (the server auto-draws a pipeline diagram from the names), overview, dataFlow[], decisions, scale. Fixed layout: overview diagram → components + data flow → key decisions → scale & failure.",
  publishProductDemo:
    "Publish a branded PRODUCT DEMO walkthrough as a structured, stepped surface (hook → problem → feature → proof → cta). Pass: hook{headline,sub,stats[]}, problem{text,stats[]}, featureTitle + features[]{title,body}, proof{stats[],quote,quoteBy}, cta{headline,body,actions[],tags[]}. The server renders the animate-kit stepper so the demo plays/scrubs the same way every time.",
  publishProductDirection:
    "THE tool for the 'wf product style' — visualize what a product looks like and weigh options with pros & cons, ending in a 'Leaning & why' recommendation. You supply typed fields; the server renders the fixed Wealthfront product-direction layout (branded `.wf` spine: Direction eyebrow → product view → detail → alternatives → comparison → phasing → leaning) so EVERY surface comes out consistent and polished — never hand-roll this in html. Pass: direction (the one-line likely path, shown in the 'Direction' chip), heading (the serif title), sub, view (RAW html of the bespoke product mockup — the ONE freehand slot; author it with the kit's classes: a `.frame` app mockup with `.side`/`.main`/`.body`, or a `.flow` pipeline), detail[]{icon,title,body}, alternatives[]{key,icon,title,tag{label,kind:future|interrupts|non-blocking|shortcut|cost},mockup(optional raw html),pro,con,lean(true on the recommended one)}, comparison{headers[],rows[]{label,cells[]},winner(1-based option column)}, phases[]{when:now|next|later,title,items[]}, and leaning{verdict,recommendation,why,alternatives} (the payoff — always include). Pins the wealthfront theme + kit. For free-form product art that doesn't fit this spine, fall back to publish_surface with blueprint:\"wealthfront-product\".",
} as const;

export const HTTP_PRESET_TOOLS = [
  {
    name: "publish_postmortem",
    description: PRESET_TOOL_DESCRIPTIONS.publishPostmortem,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        incidentId: { type: "string" },
        summary: { type: "string" },
        impact: {
          type: "object",
          properties: {
            affected: { type: "string" },
            experience: { type: "string" },
            duration: { type: "string" },
          },
        },
        timeline: {
          type: "array",
          items: {
            type: "object",
            properties: {
              at: { type: "string" },
              event: { type: "string" },
              marker: { type: "string", enum: ["ok", "warn", "danger", "info"] },
            },
            required: ["at", "event"],
          },
        },
        fiveWhys: {
          type: "array",
          items: {
            type: "object",
            properties: { why: { type: "string" }, because: { type: "string" } },
            required: ["why", "because"],
          },
        },
        contributingFactors: { type: "string" },
        fixes: {
          type: "object",
          properties: {
            immediate: { type: "array", items: { type: "string" } },
            necessary: { type: "array", items: { type: "string" } },
            additional: { type: "array", items: { type: "string" } },
          },
        },
        wentWell: { type: "string" },
        wentPainful: { type: "string" },
        followups: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item: { type: "string" },
              status: { type: "string", enum: ["open", "done"] },
              ticket: { type: "string" },
              owner: { type: "string" },
              due: { type: "string" },
            },
            required: ["item"],
          },
        },
        impactLevel: { type: "string", enum: ["Low", "Medium", "High"] },
        reoccurrence: { type: "string", enum: ["Low", "Medium", "High"] },
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: d.sessionTitle },
        agent: { type: "string", description: d.agent },
      },
      required: ["title", "summary", "fiveWhys"],
    },
  },
  {
    name: "publish_dashboard",
    description: PRESET_TOOL_DESCRIPTIONS.publishDashboard,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        headline: {
          type: "object",
          properties: {
            value: { type: "string" },
            label: { type: "string" },
            delta: { type: "string" },
          },
          required: ["value", "label"],
        },
        stats: {
          type: "array",
          items: {
            type: "object",
            properties: { label: { type: "string" }, value: { type: "string" } },
            required: ["label", "value"],
          },
        },
        bars: {
          type: "object",
          properties: {
            caption: { type: "string" },
            data: {
              type: "array",
              items: {
                type: "object",
                properties: { label: { type: "string" }, value: { type: "number" } },
                required: ["label", "value"],
              },
            },
          },
        },
        trend: {
          type: "object",
          properties: {
            caption: { type: "string" },
            values: { type: "array", items: { type: "number" } },
          },
        },
        detail: {
          type: "array",
          items: {
            type: "object",
            properties: { label: { type: "string" }, value: { type: "string" } },
          },
        },
        takeaway: { type: "string" },
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: d.sessionTitle },
        agent: { type: "string", description: d.agent },
      },
      required: ["title", "headline"],
    },
  },
  {
    name: "publish_design_doc",
    description: PRESET_TOOL_DESCRIPTIONS.publishDesignDoc,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        status: { type: "string", enum: ["Draft", "In review", "Approved", "Implemented"] },
        meta: {
          type: "object",
          properties: {
            author: { type: "string" },
            reviewers: { type: "string" },
            links: { type: "array", items: { type: "string" } },
          },
        },
        summary: { type: "string" },
        goal: {
          type: "object",
          properties: { problem: { type: "string" }, metrics: { type: "string" } },
          required: ["problem"],
        },
        invariants: {
          type: "object",
          properties: {
            trueInvariants: { type: "string" },
            preferences: { type: "string" },
            assumptions: { type: "string" },
          },
        },
        background: { type: "string" },
        solutionSpace: {
          type: "object",
          properties: {
            note: { type: "string" },
            axes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  axis: { type: "string" },
                  options: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        label: { type: "string" },
                        chosen: { type: "boolean" },
                      },
                      required: ["label"],
                    },
                  },
                  rationale: { type: "string" },
                },
                required: ["axis", "options"],
              },
            },
          },
        },
        proposed: {
          type: "object",
          properties: {
            summary: { type: "string" },
            failureModes: { type: "string" },
            observability: { type: "string" },
          },
        },
        scope: {
          type: "object",
          properties: {
            inScope: { type: "string" },
            outScope: { type: "string" },
            milestones: { type: "array", items: { type: "string" } },
          },
        },
        rollout: { type: "string" },
        testing: { type: "string" },
        openQuestions: {
          type: "array",
          items: {
            type: "object",
            properties: { question: { type: "string" }, owner: { type: "string" } },
            required: ["question"],
          },
        },
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: d.sessionTitle },
        agent: { type: "string", description: d.agent },
      },
      required: ["title", "summary", "goal"],
    },
  },
  {
    name: "publish_status",
    description: PRESET_TOOL_DESCRIPTIONS.publishStatus,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        state: { type: "string", enum: ["on-track", "at-risk", "off-track"] },
        headline: { type: "string" },
        shipped: {
          type: "array",
          items: {
            type: "object",
            properties: { item: { type: "string" }, note: { type: "string" } },
            required: ["item"],
          },
        },
        inFlight: {
          type: "array",
          items: {
            type: "object",
            properties: { item: { type: "string" }, pct: { type: "number" } },
            required: ["item"],
          },
        },
        blockers: { type: "string" },
        next: { type: "array", items: { type: "string" } },
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: d.sessionTitle },
        agent: { type: "string", description: d.agent },
      },
      required: ["title"],
    },
  },
  {
    name: "publish_architecture",
    description: PRESET_TOOL_DESCRIPTIONS.publishArchitecture,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        overview: { type: "string" },
        components: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, role: { type: "string" } },
            required: ["name"],
          },
        },
        dataFlow: { type: "array", items: { type: "string" } },
        decisions: { type: "string" },
        scale: { type: "string" },
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: d.sessionTitle },
        agent: { type: "string", description: d.agent },
      },
      required: ["title", "components"],
    },
  },
  {
    name: "publish_product_demo",
    description: PRESET_TOOL_DESCRIPTIONS.publishProductDemo,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        hook: {
          type: "object",
          properties: {
            headline: { type: "string" },
            sub: { type: "string" },
            stats: {
              type: "array",
              items: {
                type: "object",
                properties: { value: { type: "string" }, label: { type: "string" } },
              },
            },
          },
          required: ["headline"],
        },
        problem: {
          type: "object",
          properties: {
            text: { type: "string" },
            stats: {
              type: "array",
              items: {
                type: "object",
                properties: { value: { type: "string" }, label: { type: "string" } },
              },
            },
          },
        },
        featureTitle: { type: "string" },
        features: {
          type: "array",
          items: {
            type: "object",
            properties: { title: { type: "string" }, body: { type: "string" } },
            required: ["title", "body"],
          },
        },
        proof: {
          type: "object",
          properties: {
            stats: {
              type: "array",
              items: {
                type: "object",
                properties: { value: { type: "string" }, label: { type: "string" } },
              },
            },
            quote: { type: "string" },
            quoteBy: { type: "string" },
          },
        },
        cta: {
          type: "object",
          properties: {
            headline: { type: "string" },
            body: { type: "string" },
            actions: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["headline"],
        },
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: d.sessionTitle },
        agent: { type: "string", description: d.agent },
      },
      required: ["title", "hook"],
    },
  },
  {
    name: "publish_product_direction",
    description: PRESET_TOOL_DESCRIPTIONS.publishProductDirection,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        direction: {
          type: "string",
          description: "The one-line likely path, shown in the 'Direction' chip",
        },
        heading: { type: "string", description: "The serif-italic title" },
        sub: { type: "string" },
        view: {
          type: "string",
          description:
            "RAW html of the bespoke product mockup (the one freehand slot) — author with kit classes: a .frame app mockup (.side/.main/.body) or a .flow pipeline",
        },
        detail: {
          type: "array",
          items: {
            type: "object",
            properties: {
              icon: {
                type: "string",
                description: "Tabler icon name (with or without ti- prefix)",
              },
              title: { type: "string" },
              body: { type: "string" },
            },
            required: ["title", "body"],
          },
        },
        alternatives: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string", description: 'Short label, e.g. "A"' },
              icon: { type: "string" },
              title: { type: "string" },
              tag: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  kind: {
                    type: "string",
                    enum: ["future", "interrupts", "non-blocking", "shortcut", "cost"],
                  },
                },
                required: ["label"],
              },
              mockup: { type: "string", description: "Optional raw html of a tiny in-card mockup" },
              pro: { type: "string" },
              con: { type: "string" },
              lean: { type: "boolean", description: "true on the recommended option" },
            },
            required: ["title"],
          },
        },
        comparison: {
          type: "object",
          properties: {
            headers: { type: "array", items: { type: "string" } },
            rows: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  cells: { type: "array", items: { type: "string" } },
                },
                required: ["label", "cells"],
              },
            },
            winner: { type: "number", description: "1-based option column to highlight" },
          },
        },
        phases: {
          type: "array",
          items: {
            type: "object",
            properties: {
              when: { type: "string", enum: ["now", "next", "later"] },
              title: { type: "string" },
              items: { type: "array", items: { type: "string" } },
            },
            required: ["when", "items"],
          },
        },
        leaning: {
          type: "object",
          properties: {
            verdict: {
              type: "string",
              description: "Short pill text, e.g. 'Recommend the Memory tab'",
            },
            recommendation: { type: "string" },
            why: { type: "string" },
            alternatives: { type: "string", description: "When each alternative would win" },
          },
          required: ["recommendation"],
        },
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: d.sessionTitle },
        agent: { type: "string", description: d.agent },
      },
      required: ["title", "leaning"],
    },
  },
] as const;

export const STDIO_PRESET_INPUT_SCHEMAS = {
  publishPostmortem: {
    title: z.string(),
    incidentId: z.string().optional(),
    summary: z.string(),
    impact: z
      .object({
        affected: z.string().optional(),
        experience: z.string().optional(),
        duration: z.string().optional(),
      })
      .optional(),
    timeline: z
      .array(
        z.object({
          at: z.string(),
          event: z.string(),
          marker: z.enum(["ok", "warn", "danger", "info"]).optional(),
        }),
      )
      .optional(),
    fiveWhys: z.array(z.object({ why: z.string(), because: z.string() })),
    contributingFactors: z.string().optional(),
    fixes: z
      .object({
        immediate: z.array(z.string()).optional(),
        necessary: z.array(z.string()).optional(),
        additional: z.array(z.string()).optional(),
      })
      .optional(),
    wentWell: z.string().optional(),
    wentPainful: z.string().optional(),
    followups: z
      .array(
        z.object({
          item: z.string(),
          status: z.enum(["open", "done"]).optional(),
          ticket: z.string().optional(),
          owner: z.string().optional(),
          due: z.string().optional(),
        }),
      )
      .optional(),
    impactLevel: z.enum(["Low", "Medium", "High"]).optional(),
    reoccurrence: z.enum(["Low", "Medium", "High"]).optional(),
    sessionTitle: z.string().optional().describe(d.stdioSessionTitle),
  },
  publishDashboard: {
    title: z.string(),
    headline: z.object({ value: z.string(), label: z.string(), delta: z.string().optional() }),
    stats: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
    bars: z
      .object({
        caption: z.string().optional(),
        data: z.array(z.object({ label: z.string(), value: z.number() })),
      })
      .optional(),
    trend: z.object({ caption: z.string().optional(), values: z.array(z.number()) }).optional(),
    detail: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
    takeaway: z.string().optional(),
    sessionTitle: z.string().optional().describe(d.stdioSessionTitle),
  },
  publishDesignDoc: {
    title: z.string(),
    status: z.enum(["Draft", "In review", "Approved", "Implemented"]).optional(),
    meta: z
      .object({
        author: z.string().optional(),
        reviewers: z.string().optional(),
        links: z.array(z.string()).optional(),
      })
      .optional(),
    summary: z.string(),
    goal: z.object({ problem: z.string(), metrics: z.string().optional() }),
    invariants: z
      .object({
        trueInvariants: z.string().optional(),
        preferences: z.string().optional(),
        assumptions: z.string().optional(),
      })
      .optional(),
    background: z.string().optional(),
    solutionSpace: z
      .object({
        note: z.string().optional(),
        axes: z.array(
          z.object({
            axis: z.string(),
            options: z.array(z.object({ label: z.string(), chosen: z.boolean().optional() })),
            rationale: z.string().optional(),
          }),
        ),
      })
      .optional(),
    proposed: z
      .object({
        summary: z.string().optional(),
        failureModes: z.string().optional(),
        observability: z.string().optional(),
      })
      .optional(),
    scope: z
      .object({
        inScope: z.string().optional(),
        outScope: z.string().optional(),
        milestones: z.array(z.string()).optional(),
      })
      .optional(),
    rollout: z.string().optional(),
    testing: z.string().optional(),
    openQuestions: z
      .array(z.object({ question: z.string(), owner: z.string().optional() }))
      .optional(),
    sessionTitle: z.string().optional().describe(d.stdioSessionTitle),
  },
  publishStatus: {
    title: z.string(),
    state: z.enum(["on-track", "at-risk", "off-track"]).optional(),
    headline: z.string().optional(),
    shipped: z.array(z.object({ item: z.string(), note: z.string().optional() })).optional(),
    inFlight: z.array(z.object({ item: z.string(), pct: z.number().optional() })).optional(),
    blockers: z.string().optional(),
    next: z.array(z.string()).optional(),
    sessionTitle: z.string().optional().describe(d.stdioSessionTitle),
  },
  publishArchitecture: {
    title: z.string(),
    overview: z.string().optional(),
    components: z.array(z.object({ name: z.string(), role: z.string().optional() })),
    dataFlow: z.array(z.string()).optional(),
    decisions: z.string().optional(),
    scale: z.string().optional(),
    sessionTitle: z.string().optional().describe(d.stdioSessionTitle),
  },
  publishProductDemo: {
    title: z.string(),
    hook: z.object({
      headline: z.string(),
      sub: z.string().optional(),
      stats: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
    }),
    problem: z
      .object({
        text: z.string().optional(),
        stats: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
      })
      .optional(),
    featureTitle: z.string().optional(),
    features: z.array(z.object({ title: z.string(), body: z.string() })).optional(),
    proof: z
      .object({
        stats: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
        quote: z.string().optional(),
        quoteBy: z.string().optional(),
      })
      .optional(),
    cta: z.object({
      headline: z.string(),
      body: z.string().optional(),
      actions: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
    }),
    sessionTitle: z.string().optional().describe(d.stdioSessionTitle),
  },
  publishProductDirection: {
    title: z.string(),
    direction: z
      .string()
      .optional()
      .describe("The one-line likely path, shown in the 'Direction' chip"),
    heading: z.string().optional().describe("The serif-italic title"),
    sub: z.string().optional(),
    view: z
      .string()
      .optional()
      .describe(
        "RAW html of the bespoke product mockup (the one freehand slot) — kit classes: a .frame app mockup (.side/.main/.body) or a .flow pipeline",
      ),
    detail: z
      .array(z.object({ icon: z.string().optional(), title: z.string(), body: z.string() }))
      .optional(),
    alternatives: z
      .array(
        z.object({
          key: z.string().optional(),
          icon: z.string().optional(),
          title: z.string(),
          tag: z
            .object({
              label: z.string(),
              kind: z.enum(["future", "interrupts", "non-blocking", "shortcut", "cost"]).optional(),
            })
            .optional(),
          mockup: z.string().optional(),
          pro: z.string().optional(),
          con: z.string().optional(),
          lean: z.boolean().optional(),
        }),
      )
      .optional(),
    comparison: z
      .object({
        headers: z.array(z.string()).optional(),
        rows: z.array(z.object({ label: z.string(), cells: z.array(z.string()) })).optional(),
        winner: z.number().optional().describe("1-based option column to highlight"),
      })
      .optional(),
    phases: z
      .array(
        z.object({
          when: z.enum(["now", "next", "later"]),
          title: z.string().optional(),
          items: z.array(z.string()),
        }),
      )
      .optional(),
    leaning: z.object({
      verdict: z.string().optional(),
      recommendation: z.string(),
      why: z.string().optional(),
      alternatives: z.string().optional(),
    }),
    sessionTitle: z.string().optional().describe(d.stdioSessionTitle),
  },
} as const;
