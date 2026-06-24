// Tiny classnames helper: joins a base class with any conditional classes whose
// value is truthy. Replaces Solid's classList={{...}} in the React port.
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
