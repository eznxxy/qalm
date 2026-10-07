import "@testing-library/jest-dom";
// jsdom has no fetch implementation; polyfill it for unit tests.
import "whatwg-fetch";

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
