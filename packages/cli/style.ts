// ANSI styling + column tables for the human output (zero-dep, node built-ins
// only). Color turns on for a real terminal — stdout a TTY, TERM not "dumb",
// NO_COLOR unset — and FORCE_COLOR (anything but "0") forces it on for tests
// and pipes that want it. --json output never passes through here.
const colorEnabled = (() => {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined) return process.env.FORCE_COLOR !== "0";
  return !!process.stdout.isTTY && process.env.TERM !== "dumb";
})();

const style = (open: number, close: number) => (s: string) =>
  colorEnabled ? `\u001b[${open}m${s}\u001b[${close}m` : s;

export const bold = style(1, 22);
export const dim = style(2, 22);
export const underline = style(4, 24);
export const red = style(31, 39);
export const green = style(32, 39);
export const yellow = style(33, 39);
export const cyan = style(36, 39);

// Visible width — styled cells must not skew their column. A scanner rather
// than a regex: a control character in a regex (literal or constructed) trips
// no-control-regex. Skips ESC…m sequences, counts the rest.
const ESC = "\u001b";
function width(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ESC) {
      while (i < s.length && s[i] !== "m") i++;
    } else {
      n++;
    }
  }
  return n;
}

// Align rows into columns, two spaces apart, last column unpadded. Cells may
// already carry ANSI styles.
export function table(rows: string[][], opts: { indent?: string } = {}): string {
  if (rows.length === 0) return "";
  const cols = Math.max(...rows.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, i) =>
    Math.max(...rows.map((r) => (r[i] !== undefined ? width(r[i]) : 0))),
  );
  return rows
    .map(
      (r) =>
        (opts.indent ?? "") +
        r
          .map((cell, i) =>
            i === r.length - 1 ? cell : cell + " ".repeat(widths[i] - width(cell)),
          )
          .join("  ")
          .trimEnd(),
    )
    .join("\n");
}
