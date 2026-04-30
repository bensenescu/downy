import { useEffect, useRef, useState } from "react";

// App-native replacement for window.confirm / window.alert.
//
// Usage:
//   const ok = await confirmDialog({ message: "Delete this?", tone: "danger" });
//   if (!ok) return;
//
// Mount <DialogHost/> once at the app root. The imperative API publishes
// requests through a module-level listener so call sites don't have to thread
// a context or hook around — same ergonomics as window.confirm.
type Tone = "neutral" | "danger";

type ConfirmRequest = {
  kind: "confirm";
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
  resolve: (value: boolean) => void;
};

type AlertRequest = {
  kind: "alert";
  title?: string;
  message: string;
  tone?: Tone;
  resolve: () => void;
};

type DialogRequest = ConfirmRequest | AlertRequest;

let listener: ((req: DialogRequest) => void) | null = null;

function setListener(fn: ((req: DialogRequest) => void) | null) {
  listener = fn;
}

export function confirmDialog(opts: {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!listener) {
      // Pre-hydrate or host not mounted — degrade to native so behaviour stays
      // correct rather than silently dropping the prompt.
      resolve(typeof window !== "undefined" && window.confirm(opts.message));
      return;
    }
    listener({ kind: "confirm", ...opts, resolve });
  });
}

export function alertDialog(opts: {
  title?: string;
  message: string;
  tone?: Tone;
}): Promise<void> {
  return new Promise((resolve) => {
    if (!listener) {
      if (typeof window !== "undefined") window.alert(opts.message);
      resolve();
      return;
    }
    listener({
      kind: "alert",
      ...opts,
      resolve: () => {
        resolve();
      },
    });
  });
}

export function DialogHost() {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Survives StrictMode double-invoke: dialog.showModal() throws if the
  // dialog is already open, so we gate on the native `open` attribute.
  useEffect(() => {
    setListener((req) => {
      setRequest(req);
    });
    return () => {
      setListener(null);
    };
  }, []);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (request && !el.open) el.showModal();
  }, [request]);

  function settle(result: boolean) {
    if (!request) return;
    if (request.kind === "confirm") request.resolve(result);
    else request.resolve();
    dialogRef.current?.close();
    setRequest(null);
  }

  if (!request) return null;
  const tone = request.tone ?? "neutral";
  const confirmBtnClass =
    tone === "danger" ? "btn btn-error" : "btn btn-primary";

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      onClose={() => {
        settle(false);
      }}
    >
      <div className="modal-box max-w-md border border-base-300 shadow-2xl">
        {request.title ? (
          <h3 className="text-base font-semibold">{request.title}</h3>
        ) : null}
        <p
          className={`whitespace-pre-line text-sm text-base-content/75 ${
            request.title ? "mt-2" : ""
          }`}
        >
          {request.message}
        </p>
        <div className="modal-action mt-5">
          {request.kind === "confirm" ? (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  settle(false);
                }}
              >
                {request.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="button"
                className={`${confirmBtnClass} btn-sm`}
                onClick={() => {
                  settle(true);
                }}
                autoFocus
              >
                {request.confirmLabel ?? "Confirm"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                settle(true);
              }}
              autoFocus
            >
              OK
            </button>
          )}
        </div>
      </div>
      {/* Backdrop click closes — native <dialog> emits a `cancel` event which
          fires `onClose` and routes through settle(false). The bg-* class
          here paints the ::backdrop area so the modal floats over a tinted
          surface instead of the bare app background. */}
      <form method="dialog" className="modal-backdrop bg-base-300/60">
        <button type="submit" aria-label="Close">
          close
        </button>
      </form>
    </dialog>
  );
}
