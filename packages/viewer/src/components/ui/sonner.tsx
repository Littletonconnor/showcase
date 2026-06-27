import { Toaster as Sonner, type ToasterProps } from "sonner";

import { useResolvedMode } from "@/theme";

// shadcn's Sonner wrapper, adapted to showcase's own theme system: the resolved
// light/dark mode comes from the board store (useResolvedMode), not next-themes,
// and the toast colours bridge onto the theme vars so they re-theme with the
// board. Positioned bottom-center to match where the old hand-rolled #toast sat.
const Toaster = ({ ...props }: ToasterProps) => {
  const mode = useResolvedMode();

  return (
    <Sonner
      theme={mode}
      position="bottom-center"
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--surface)",
          "--normal-text": "var(--text)",
          "--normal-border": "var(--border-2)",
          "--border-radius": "10px",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
