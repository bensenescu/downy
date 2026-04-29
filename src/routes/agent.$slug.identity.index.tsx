import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useMemo } from "react";

import { withBack } from "../lib/back-nav";
import { useCoreFiles, useUserFile } from "../lib/queries";

export const Route = createFileRoute("/agent/$slug/identity/")({
  component: IdentityPage,
});

function formatTimestamp(updatedAt: number | null): string {
  if (!updatedAt) return "";
  const date = new Date(updatedAt);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const datePart = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const timePart = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `edited ${datePart} · ${timePart}`;
}

function contentPeek(content: string, maxChars = 200): string {
  // Skip leading headings — they usually echo the file's label and don't
  // tell the user what the actual body is about. Grab the first prose line.
  const lines = content.split("\n").map((l) => l.trim());
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith("#")) continue;
    const cleaned = line.replace(/^[>\-*]+\s*/, "").trim();
    if (!cleaned) continue;
    if (cleaned.length <= maxChars) return cleaned;
    return cleaned.slice(0, maxChars - 1).trimEnd() + "…";
  }
  return "";
}

function IdentityPage() {
  const { slug } = Route.useParams();
  const coreFilesQ = useCoreFiles(slug);
  const userFileQ = useUserFile();

  // Identity-page list = the four agent core files + USER.md (which lives at
  // the user level). Both queries are independently cached, so re-visits are
  // instant; we just compose the results here.
  const files = useMemo(() => {
    if (!coreFilesQ.data || !userFileQ.data) return null;
    return [...coreFilesQ.data, userFileQ.data];
  }, [coreFilesQ.data, userFileQ.data]);

  const fetchError = coreFilesQ.error ?? userFileQ.error;
  const displayError = fetchError
    ? fetchError instanceof Error
      ? fetchError.message
      : String(fetchError)
    : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-8">
      <Link
        to="/agent/$slug"
        params={{ slug }}
        className="link link-hover mb-4 inline-flex items-center gap-1 text-sm text-base-content/70 hover:text-base-content"
      >
        <ChevronLeft size={14} />
        Back to chat
      </Link>

      <div className="mb-8">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">
          Identity
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Files that shape this agent.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-base-content/70 sm:text-base">
          Read on every turn. The agent writes to these too.
        </p>
      </div>

      {displayError ? (
        <div role="alert" className="alert alert-error mb-4">
          <span>{displayError}</span>
        </div>
      ) : null}

      {!files && !displayError ? (
        <div className="flex items-center gap-2 text-sm text-base-content/60">
          <span className="loading loading-spinner loading-sm" />
          <span>Loading…</span>
        </div>
      ) : null}

      {files ? (
        <ul className="-mx-1 divide-y divide-base-300/70 border-y border-base-300/70">
          {files.map((file) => {
            const peek = file.isDefault ? "" : contentPeek(file.content);
            const stamp = formatTimestamp(file.updatedAt);
            return (
              <li key={file.path}>
                <Link
                  to="/agent/$slug/identity/$"
                  params={{
                    slug,
                    _splat: file.path
                      .split("/")
                      .map((s) => encodeURIComponent(s))
                      .join("/"),
                  }}
                  state={withBack({
                    href: `/agent/${slug}/identity`,
                    label: "identity",
                  })}
                  className="group block px-3 py-5 no-underline transition-colors hover:bg-base-200"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-xs text-base-content/60 transition-colors group-hover:text-base-content/85">
                      {file.path}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-base-content/40">
                      {file.isDefault ? "default" : stamp}
                    </span>
                  </div>
                  <h2 className="mt-2 text-base font-semibold tracking-tight">
                    {file.label}
                  </h2>
                  <p className="mt-1 text-sm text-base-content/65">
                    {file.description}
                  </p>
                  {peek ? (
                    <p className="mt-3 line-clamp-2 text-[12.5px] italic leading-relaxed text-base-content/45">
                      {peek}
                    </p>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </main>
  );
}
