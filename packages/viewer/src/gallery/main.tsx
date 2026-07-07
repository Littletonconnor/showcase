// The part gallery — a server-free dev harness that renders every part kind
// through the REAL PartRenderer with fixture data. `pnpm gallery` serves it at
// /gallery.html (dev only; the production build still emits the single
// index.html). Use it to eyeball a renderer change across every part at once
// instead of hand-publishing surfaces.
import { createRoot } from "react-dom/client";
import { renderHtmlPage } from "@showcase/core/surfacePage";
import { PartRenderer } from "../PartRenderer.tsx";
import { initTheme, useActiveTheme, useResolvedMode } from "../theme.ts";
import { GALLERY, type GalleryEntry } from "./fixtures.ts";
import "../index.css";
import "../styles.css";

initTheme();

function Entry(props: { entry: GalleryEntry }) {
  const { entry } = props;
  const theme = useActiveTheme();
  const mode = useResolvedMode();
  return (
    <section id={entry.id} className="scroll-mt-4">
      <h2 className="mb-1 text-[13px] font-semibold text-foreground">{entry.label}</h2>
      {entry.note ? <p className="mb-1.5 text-[11.5px] text-faint">{entry.note}</p> : null}
      <article className="overflow-hidden rounded-xl border-[0.5px] border-border bg-card">
        {entry.surface.parts.map((part, i) => (
          <PartRenderer
            key={i}
            surface={entry.surface}
            index={i}
            threads={[]}
            frameRef={() => {}}
            // No server behind the gallery, so html parts get the same
            // pre-rendered sandbox doc the static export uses instead of the
            // /s/:id route.
            exportDoc={
              part.kind === "html"
                ? renderHtmlPage({
                    title: entry.surface.title,
                    html: part.html,
                    origin: location.origin,
                    theme,
                    mode,
                    kits: part.kits,
                  })
                : undefined
            }
            theme={theme}
            mode={mode}
          />
        ))}
      </article>
    </section>
  );
}

function Gallery() {
  return (
    <div className="mx-auto flex max-w-5xl gap-6 px-4 py-6">
      <nav className="sticky top-6 hidden h-fit w-44 flex-none flex-col gap-1 md:flex">
        <span className="mb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">
          Part gallery
        </span>
        {GALLERY.map((e) => (
          <a
            key={e.id}
            href={`#${e.id}`}
            className="truncate rounded px-1.5 py-0.5 text-[12px] text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            {e.label}
          </a>
        ))}
        <span className="mt-2 text-[11px] text-faint">Colors follow the OS light/dark scheme.</span>
      </nav>
      <main className="flex min-w-0 flex-1 flex-col gap-6">
        {GALLERY.map((e) => (
          <Entry key={e.id} entry={e} />
        ))}
      </main>
    </div>
  );
}

createRoot(document.body).render(<Gallery />);
