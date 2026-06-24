import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// shadcn's class merge helper: resolves conditional + conflicting Tailwind
// classes (later wins) so component variants compose cleanly.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
