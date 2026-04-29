import { createFileRoute } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";

const README_HREF = "https://github.com/bensenescu/downy#cloudflare-access";

export const Route = createFileRoute("/unauthenticated")({
  component: UnauthenticatedPage,
});

function UnauthenticatedPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-xl items-center justify-center px-4 py-12">
      <div className="card w-full bg-base-100 border border-base-300 shadow-xl">
        <div className="card-body gap-4">
          <div className="flex items-center gap-3">
            <span className="text-warning">
              <ShieldAlert size={28} />
            </span>
            <h1 className="card-title text-2xl">Authentication required</h1>
          </div>

          <p className="text-sm text-base-content/80">
            Missing or invalid Cloudflare Access JWT.
          </p>

          <p className="text-sm text-base-content/70">
            Operators: see{" "}
            <a
              className="link link-primary"
              href={README_HREF}
              target="_blank"
              rel="noreferrer"
            >
              the README
            </a>
            .
          </p>
        </div>
      </div>
    </main>
  );
}
