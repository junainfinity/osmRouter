import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-24 text-center">
      <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border border-fd-border bg-fd-card text-fd-muted-foreground mb-6">
        <span className="w-1.5 h-1.5 rounded-full bg-fd-primary" />
        v1.0 docs · pinned-TLS + role-inverted HTTP/2
      </span>
      <h1 className="text-5xl font-semibold tracking-tight max-w-3xl">
        Documentation for the sovereign net.
      </h1>
      <p className="text-lg text-fd-muted-foreground mt-5 max-w-2xl">
        Everything you need to bind a custom domain to a process on your own hardware —
        and serve it to the public web with zero per-vCPU rent.
      </p>
      <div className="flex gap-3 mt-9">
        <Link
          href="/docs"
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-semibold bg-fd-primary text-fd-primary-foreground hover:opacity-90"
        >
          Read the docs →
        </Link>
        <Link
          href="/docs/getting-started/quick-start"
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-medium border border-fd-border text-fd-foreground hover:bg-fd-accent"
        >
          5-minute quick start
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-16 max-w-4xl w-full text-left">
        {[
          {
            t: "Concepts",
            d: "Architecture, sovereignty, the role-inverted tunnel.",
            href: "/docs/concepts/architecture",
          },
          {
            t: "Mac app",
            d: "Install, sign in, bind a domain in 60 seconds.",
            href: "/docs/mac-app/install-and-signin",
          },
          {
            t: "Troubleshooting",
            d: "When the tunnel is up but requests aren't landing — walk this list.",
            href: "/docs/troubleshooting/tunnel-diagnostics",
          },
        ].map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="block p-5 rounded-xl border border-fd-border bg-fd-card hover:bg-fd-accent transition-colors"
          >
            <div className="text-sm font-semibold mb-1">{c.t}</div>
            <div className="text-sm text-fd-muted-foreground">{c.d}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
