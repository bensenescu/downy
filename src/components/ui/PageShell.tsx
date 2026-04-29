import type { ReactNode } from "react";

type Width = "narrow" | "default" | "wide";

const WIDTH_CLASS: Record<Width, string> = {
  narrow: "max-w-3xl",
  default: "max-w-3xl",
  wide: "max-w-5xl",
};

// Standard `<main>` wrapper used by every settings/list/detail route. Centers
// content, applies the gutters and vertical rhythm we want on every page.
export default function PageShell({
  width = "default",
  children,
}: {
  width?: Width;
  children: ReactNode;
}) {
  return (
    <main className={`mx-auto w-full ${WIDTH_CLASS[width]} px-4 pb-12 pt-8`}>
      {children}
    </main>
  );
}
