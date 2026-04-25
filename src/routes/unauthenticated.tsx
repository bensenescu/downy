import { createFileRoute } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";

const README_HREF = "https://github.com/bensenescu/emily#cloudflare-access";

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
            This deployment is gated by Cloudflare Access. Your request did not
            include a valid{" "}
            <code className="kbd kbd-sm">cf-access-jwt-assertion</code>.
          </p>

          <p className="text-sm text-base-content/70">
            If you're the operator, finish wiring Access on the Worker route and
            set <code className="kbd kbd-sm">TEAM_DOMAIN</code> and{" "}
            <code className="kbd kbd-sm">POLICY_AUD</code> in the dashboard.
          </p>

          <div className="card-actions justify-end pt-2">
            <a
              className="btn btn-primary btn-sm"
              href={README_HREF}
              target="_blank"
              rel="noreferrer"
            >
              Setup instructions
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
