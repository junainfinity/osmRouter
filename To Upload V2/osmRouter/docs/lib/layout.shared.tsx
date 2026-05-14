import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

// Shared nav/branding used by BOTH the HomeLayout (the marketing-ish landing
// at /) and the DocsLayout (the actual /docs/* tree). Keep them in sync here.
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="font-semibold tracking-tight">
          osm<span className="text-fd-muted-foreground">Router</span> docs
        </span>
      ),
      url: "/",
    },
    links: [
      {
        type: "main",
        text: "Docs",
        url: "/docs",
      },
      {
        type: "main",
        text: "Dashboard",
        url: "https://osmrouter.com",
        external: true,
      },
      {
        type: "main",
        text: "GitHub",
        url: "https://github.com/junainfinity/osmRouter",
        external: true,
      },
    ],
  };
}
