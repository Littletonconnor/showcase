// Tiny classnames helper: joins a base class with any conditional classes whose
// value is truthy.
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
