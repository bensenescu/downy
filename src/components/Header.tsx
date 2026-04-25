import { Link } from "@tanstack/react-router";
import { Settings as SettingsIcon, User } from "lucide-react";

export default function Header() {
  return (
    <header className="navbar sticky top-0 z-50 border-b border-base-300 bg-base-100/80 px-2 backdrop-blur-lg sm:px-4">
      <div className="navbar-start">
        <Link
          to="/"
          className="flex items-center gap-2 px-2 py-1 text-base font-semibold no-underline hover:opacity-80"
        >
          <span className="size-2 rounded-full bg-primary" />
          OpenClaw
        </Link>
      </div>

      <div className="navbar-end gap-1">
        <div className="dropdown dropdown-end">
          <div
            tabIndex={0}
            role="button"
            aria-label="Open user menu"
            className="btn btn-ghost btn-sm btn-square"
          >
            <User size={16} />
          </div>
          <ul
            tabIndex={0}
            className="menu dropdown-content z-[60] mt-3 w-44 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
          >
            <li>
              <Link to="/settings" className="gap-2">
                <SettingsIcon size={14} />
                Settings
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </header>
  );
}
