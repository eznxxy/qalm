import "@testing-library/jest-dom";
// jsdom has no fetch implementation; polyfill it for unit tests.
import "whatwg-fetch";

// jsdom has no matchMedia either; components that query breakpoints (the §3
// collapse hook reads (max-width: 1279px) on every shell render) need it.
// Default "wide" (matches: false); suites that exercise breakpoints define
// their own per-file stub on top of this.
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockImplementation(() => ({
      matches: false,
      media: "",
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}

// Router is irrelevant to these unit tests; stub it so client components
// using next/navigation render without a real app router.
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: jest.fn(),
    push: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
