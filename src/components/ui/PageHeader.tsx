import type { ReactNode } from "react";

// The kicker (small uppercase label) + title + optional description block that
// every settings/list page leads with. `right` slot is for actions like a
// Refresh button rendered next to the title.
export default function PageHeader({
  kicker,
  title,
  description,
  right,
}: {
  kicker: string;
  title: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">
          {kicker}
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm text-base-content/70 sm:text-base">
            {description}
          </p>
        ) : null}
      </div>
      {right ? <div className="flex-shrink-0">{right}</div> : null}
    </div>
  );
}
