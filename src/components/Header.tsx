import { Link } from "@tanstack/react-router";
import ThemeToggle from "./ThemeToggle";

const NAV_LINKS = [
  { to: "/", label: "Chat", exact: true },
  { to: "/settings", label: "Settings", exact: false },
  { to: "/workspace", label: "Workspace", exact: false },
] as const;

export default function Header() {
  return (
    <header className="navbar sticky top-0 z-50 border-b border-base-300 bg-base-100/80 px-4 backdrop-blur-lg">
      <div className="navbar-start">
        <Link
          to="/"
          className="btn btn-ghost gap-2 px-2 text-base font-semibold normal-case"
        >
          <span className="size-2 rounded-full bg-primary" />
          OpenClaw
        </Link>
      </div>

      <div className="navbar-center hidden md:flex">
        <ul className="menu menu-horizontal gap-1 px-1">
          {NAV_LINKS.map((link) => (
            <li key={link.to}>
              <Link
                to={link.to}
                activeProps={{
                  className: "bg-primary/10 font-semibold text-primary",
                }}
                activeOptions={{ exact: link.exact }}
                className="text-base-content/70 hover:text-base-content"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="navbar-end gap-1">
        <div className="md:hidden">
          <div className="dropdown dropdown-end">
            <div
              tabIndex={0}
              role="button"
              aria-label="Open navigation menu"
              className="btn btn-ghost btn-sm btn-square"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="size-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </div>
            <ul
              tabIndex={0}
              className="menu dropdown-content z-[60] mt-3 w-48 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
            >
              {NAV_LINKS.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    activeProps={{
                      className: "bg-primary/10 font-semibold text-primary",
                    }}
                    activeOptions={{ exact: link.exact }}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
