import { Link } from "@tanstack/react-router";
import ThemeToggle from "./ThemeToggle";

const NAV_LINKS = [
  { to: "/", label: "Chat" },
  { to: "/settings", label: "Settings" },
  { to: "/workspace", label: "Workspace" },
] as const;

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] px-4 backdrop-blur-lg">
      <nav className="page-wrap flex items-center gap-x-4 gap-y-2 py-3 sm:py-4">
        <Link
          to="/"
          className="inline-flex flex-shrink-0 items-center gap-2 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-sm font-semibold text-[var(--sea-ink)] no-underline shadow-[0_8px_24px_rgba(30,90,72,0.08)] sm:px-4 sm:py-2"
        >
          <span className="h-2 w-2 rounded-full bg-[linear-gradient(90deg,#56c6be,#7ed3bf)]" />
          OpenClaw
        </Link>

        <div className="flex flex-1 items-center gap-4 text-sm font-semibold">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="nav-link"
              activeProps={{ className: "nav-link is-active" }}
              activeOptions={{ exact: link.to === "/" }}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <ThemeToggle />
      </nav>
    </header>
  );
}
