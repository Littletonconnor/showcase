// WCAG: every sandboxed part iframe carries an accessible title naming what
// it holds (the html-part iframe's title is covered in PartRenderer.test).
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CodePart } from "./CodePart.tsx";
import { MarkdownPart } from "./MarkdownPart.tsx";
import { TerminalPart } from "./TerminalPart.tsx";

const frameTitle = (container: HTMLElement) =>
  container.querySelector("iframe")?.getAttribute("title");

describe("sandboxed part iframe titles", () => {
  it("terminal: generic title, or the window title when set", () => {
    const bare = render(<TerminalPart part={{ kind: "terminal", text: "$ ls" }} />);
    expect(frameTitle(bare.container)).toBe("Terminal output");
    bare.unmount();

    const named = render(
      <TerminalPart part={{ kind: "terminal", text: "$ ls", title: "build shell" }} />,
    );
    expect(frameTitle(named.container)).toBe("Terminal — build shell");
  });

  it("markdown: titled", () => {
    const { container } = render(<MarkdownPart part={{ kind: "markdown", markdown: "# hi" }} />);
    expect(frameTitle(container)).toBe("Markdown");
  });

  it("code: generic title, or the file title when set", () => {
    const { container } = render(<CodePart part={{ kind: "code", code: "x", title: "app.ts" }} />);
    expect(frameTitle(container)).toBe("Code — app.ts");
  });
});
