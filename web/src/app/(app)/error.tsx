"use client";

/**
 * §6 error state for the shell's content area (card t_83e34f50).
 *
 * Next's error.tsx convention wraps the route segment's page + nested
 * layouts BELOW the (app) layout — so when a screen throws, the §3 shell
 * (top bar, sidebar, focus order) stays intact and only this fallback
 * replaces the content area. The error boundary does not wrap the layout
 * of its own segment, which is exactly the "content area" scope the card
 * asks for; the root layout keeps its default Next fallback.
 *
 * Copy follows §6: what happened + what to do next, no apology. Retry
 * re-renders the failed segment via the framework-provided `retry`
 * (Next 16 signature — see node_modules/next/dist/docs error.md).
 */
import { useEffect } from "react";

export default function AppSegmentError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // The error-reporting hook-up point (no service exists yet). The digest
    // matches this occurrence to the server logs for server-side throws.
    console.error(error);
  }, [error]);

  return (
    <div className="page shell-error" role="alert">
      <h1>Something went wrong</h1>
      <p className="t-body">
        Couldn&apos;t load this page. Check your connection and retry.
      </p>
      {error.digest && (
        <p className="t-caption">Error reference: {error.digest}</p>
      )}
      <div className="button-row">
        <button type="button" className="primary" onClick={retry}>
          Retry
        </button>
      </div>
    </div>
  );
}
