import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // A low-alpha ink wash, so the placeholder reads on both the panel
      // (sidebar) and the card surface — bg-accent maps to the panel colour in
      // this theme and would be invisible on the sidebar.
      className={cn("animate-pulse rounded-md bg-foreground/[0.08]", className)}
      {...props}
    />
  );
}

export { Skeleton };
