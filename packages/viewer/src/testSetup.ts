import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// RTL's auto-cleanup hooks into test-framework globals, which we don't enable
// — unmount explicitly so renders never leak across tests.
afterEach(cleanup);

// jsdom lacks the layout/observer APIs the components lean on; stub the
// minimum so mounting them doesn't throw. Behavior that depends on real
// layout stays with the Playwright oracle.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.IntersectionObserver ??= NoopObserver as unknown as typeof IntersectionObserver;
globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

// scrollIntoView is missing from jsdom elements entirely.
Element.prototype.scrollIntoView ??= () => {};
