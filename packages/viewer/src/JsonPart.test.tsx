// The collapsible JSON tree: trusted React text nodes (never markup), root
// open by default, nested containers collapsed to a summary until toggled.
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { JsonPart } from "./JsonPart.tsx";

describe("JsonPart", () => {
  it("renders primitives with JSON syntax, as text", () => {
    const { container } = render(
      <JsonPart part={{ kind: "json", data: { s: "<b>hi</b>", n: 42, t: true, z: null } }} />,
    );
    // Rendered as literal text — markup in a string value must never become DOM.
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain('"s"');
    expect(container.textContent).toContain('"<b>hi</b>"');
    expect(container.textContent).toContain("42");
    expect(container.textContent).toContain("true");
    expect(container.textContent).toContain("null");
  });

  it("collapses nested containers to a summary and expands on click", async () => {
    const { container } = render(
      <JsonPart part={{ kind: "json", data: { nested: { a: 1, b: 2 } } }} />,
    );
    expect(container.textContent).toContain("2 keys");
    expect(container.textContent).not.toContain('"a"');

    // Two toggles render: the open root and the collapsed child — click the child.
    const toggles = [...container.querySelectorAll("span.cursor-pointer")];
    await userEvent.click(toggles[1]);
    expect(container.textContent).toContain('"a"');
    expect(container.textContent).not.toContain("2 keys");
  });

  it("renders empty containers inline", () => {
    const { container } = render(<JsonPart part={{ kind: "json", data: [] }} />);
    expect(container.textContent).toContain("[]");
  });
});
