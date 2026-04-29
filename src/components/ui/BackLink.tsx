import { Link, type LinkProps } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

// "Back to <somewhere>" link used at the top of every detail/settings page.
// Defaults to a quiet text link; the `chip` variant adds button padding for
// detail pages where a wider tap target reads better next to action buttons.
//
// `to` is typed as a plain string so this component works equally well with
// runtime hrefs from back-nav state (e.g. `/agent/${slug}/workspace`) and
// with route literals — the underlying `<Link>` accepts both at runtime.
type Props = {
  label: string;
  variant?: "link" | "chip";
  to: string;
  params?: LinkProps["params"];
  state?: LinkProps["state"];
};

export default function BackLink({
  label,
  variant = "link",
  to,
  params,
  state,
}: Props) {
  const className =
    variant === "chip"
      ? "btn btn-ghost btn-sm mb-4 gap-1 px-2"
      : "link link-hover mb-4 inline-flex items-center gap-1 text-sm text-base-content/70 hover:text-base-content";
  return (
    <Link
      // eslint-disable-next-line typescript/no-unsafe-type-assertion -- BackLink is a generic primitive; route-tree literal inference happens at call sites that pass typed `to`s, not here.
      to={to as LinkProps["to"]}
      params={params}
      state={state}
      className={className}
      aria-label={`Back to ${label}`}
    >
      <ChevronLeft size={14} />
      Back to {label}
    </Link>
  );
}
