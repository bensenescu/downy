import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";

import Header from "../components/Header";
import { hydratePreferencesFromServer } from "../lib/preferences-sync";
import { queryClient } from "../lib/query-client";
import { THEMES } from "../lib/theme";

import appCss from "../styles.css?url";

// Inline preload — runs before React renders to avoid a flash of the default
// theme. Keep in sync with src/lib/theme.ts (storage keys + naming convention).
// The allowlist is generated at build time from THEMES so a removed/renamed
// theme in localStorage falls back to downy instead of setting a
// data-theme that has no matching CSS rule.
const VALID_IDS_JSON = JSON.stringify(THEMES.map((t) => t.id));
const THEME_INIT_SCRIPT = `(function(){try{var valid=${VALID_IDS_JSON};var id=window.localStorage.getItem('downy:theme-id');if(!id||valid.indexOf(id)===-1)id='downy';var scheme=window.localStorage.getItem('downy:color-scheme');if(scheme!=='light'&&scheme!=='dark')scheme='system';var resolved=scheme==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):scheme;var root=document.documentElement;root.setAttribute('data-theme',id+'-'+resolved);root.style.colorScheme=resolved;}catch(e){}})();`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Downy" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  // Pull any device-spanning preference overrides down into localStorage so
  // the existing localStorage-backed hooks pick them up. Idempotent.
  useEffect(() => {
    void hydratePreferencesFromServer();
  }, []);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="min-h-screen bg-base-200 text-base-content antialiased">
        <QueryClientProvider client={queryClient}>
          <div className="flex min-h-screen flex-col">
            <Header />
            <div className="flex-1">{children}</div>
          </div>
          <TanStackDevtools
            config={{ position: "bottom-right" }}
            plugins={[
              {
                name: "Tanstack Router",
                render: <TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
