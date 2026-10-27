"use client";

/**
 * AttachmentViewer — the modal behind an attachment card (review feedback,
 * card 3.7): clicking a staged or uploaded file opens it here instead of
 * downloading it. Images render in an `<img>`, PDFs in the browser's own inline
 * viewer inside an `<iframe>`; both read from a blob URL the caller owns and
 * revokes.
 *
 * Modal, unlike the drawer: scrim, focus moved into the dialog, Tab trapped,
 * Escape closes, and every other key is swallowed so the run page's shortcuts
 * cannot fire behind it (the same shield ConfirmDialog uses).
 */
import { useEffect, useRef } from "react";

export type AttachmentPreview =
  | { kind: "loading"; filename: string }
  | { kind: "ready"; filename: string; url: string; isPdf: boolean }
  | { kind: "error"; filename: string; message: string };

export interface AttachmentViewerProps {
  preview: AttachmentPreview;
  onClose: () => void;
}

export function AttachmentViewer({ preview, onClose }: AttachmentViewerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("button, a[href]")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" && event.key !== "Tab") {
        event.stopPropagation();
        return;
      }
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (!dialog) return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]")
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rd-viewer-title"
        className="dialog rd-viewer"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="rd-viewer-head">
          <h2 id="rd-viewer-title" className="rd-viewer-title" title={preview.filename}>
            {preview.filename}
          </h2>
          <button
            type="button"
            className="rd-icon-btn"
            aria-label="Close preview"
            title="Close"
            onClick={onClose}
          >
            <svg
              viewBox="0 0 10 10"
              width="10"
              height="10"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M1.5 1.5l7 7M8.5 1.5l-7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="rd-viewer-body">
          {preview.kind === "loading" && (
            <p className="rd-viewer-state" role="status">
              Loading {preview.filename}…
            </p>
          )}
          {preview.kind === "error" && (
            <p className="rd-viewer-state field-error" role="alert">
              {preview.message}
            </p>
          )}
          {preview.kind === "ready" &&
            (preview.isPdf ? (
              <iframe
                className="rd-viewer-frame"
                src={preview.url}
                title={preview.filename}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- fetched user bytes in a blob URL; nothing for next/image to optimise.
              <img
                className="rd-viewer-image"
                src={preview.url}
                alt={preview.filename}
              />
            ))}
        </div>

        <footer className="rd-viewer-actions">
          {preview.kind === "ready" && (
            <>
              <a
                className="button-link"
                href={preview.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                Open in new tab
              </a>
              <a
                className="button-link"
                href={preview.url}
                download={preview.filename}
              >
                Download
              </a>
            </>
          )}
          <button type="button" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}