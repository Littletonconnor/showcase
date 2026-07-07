// Image pin annotations: pinned threads render as numbered dots at their
// percent coordinates; resolved pins drop; without a surface (review panes,
// exports) the image stays inert. Click-to-pin needs real layout, so the
// composer flow lives in e2e.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Comment } from "./api.ts";
import { ImagePart } from "./ImagePart.tsx";
import type { Thread } from "./threads.ts";

const thread = (over: Partial<Comment>): Thread => ({
  root: {
    id: "c1",
    seq: 1,
    sessionId: "sess1",
    surfaceId: "s1",
    surfaceTitle: null,
    author: "user",
    text: "what is this widget?",
    createdAt: "2026-07-05T00:00:00Z",
    anchor: { partIndex: 0, pos: { x: 25, y: 75 } },
    ...over,
  },
  replies: [],
});

const part = { kind: "image" as const, assetId: "a1", alt: "screen" };

describe("ImagePart pins", () => {
  it("renders a numbered pin at the anchor's percent position", () => {
    const { container } = render(
      <ImagePart part={part} surfaceId="s1" partIndex={0} threads={[thread({})]} />,
    );
    const pin = container.querySelector("[data-image-pin]") as HTMLElement;
    expect(pin).toBeInTheDocument();
    expect(pin.style.left).toBe("25%");
    expect(pin.style.top).toBe("75%");
    expect(pin.textContent).toBe("1");
    expect(pin.title).toContain("what is this widget?");
  });

  it("drops resolved pins and threads without a pos", () => {
    const { container } = render(
      <ImagePart
        part={part}
        surfaceId="s1"
        partIndex={0}
        threads={[
          thread({ resolved: true }),
          thread({ id: "c2", anchor: { partIndex: 0, quote: "no pos" } }),
        ]}
      />,
    );
    expect(container.querySelectorAll("[data-image-pin]")).toHaveLength(0);
  });

  it("stays inert without a surface (review panes, exports)", () => {
    const { container } = render(<ImagePart part={part} />);
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.title).toBe("");
    expect(img.className).not.toContain("cursor-crosshair");
  });
});
