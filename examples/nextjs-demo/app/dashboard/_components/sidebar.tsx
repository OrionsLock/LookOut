"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; glyph: string };

const primary: Item[] = [
  { href: "/dashboard", label: "Overview", glyph: "◉" },
  { href: "/dashboard/keys", label: "API Keys", glyph: "◆" },
  { href: "/dashboard/settings", label: "Settings", glyph: "⚙" },
];

const secondary: Item[] = [
  { href: "/demo-a11y-bug", label: "A11y showcase", glyph: "◈" },
  { href: "/", label: "Landing", glyph: "◐" },
];

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="shell-nav" aria-label="Primary">
      <Link href="/dashboard" className="brand" aria-label="Lookout home">
        <span className="brand-mark" aria-hidden>
          L
        </span>
        <span>Lookout</span>
        <span className="badge badge-brand" style={{ marginLeft: "auto" }}>
          demo
        </span>
      </Link>

      <nav className="nav" aria-label="Main">
        <span className="nav-group-label">Workspace</span>
        {primary.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className={`nav-item${isActive(pathname, it.href) ? " is-active" : ""}`}
            aria-current={isActive(pathname, it.href) ? "page" : undefined}
          >
            <span aria-hidden style={{ width: 16, textAlign: "center", opacity: 0.8 }}>
              {it.glyph}
            </span>
            <span>{it.label}</span>
          </Link>
        ))}

        <span className="nav-group-label">Explore</span>
        {secondary.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className={`nav-item${isActive(pathname, it.href) ? " is-active" : ""}`}
          >
            <span aria-hidden style={{ width: 16, textAlign: "center", opacity: 0.8 }}>
              {it.glyph}
            </span>
            <span>{it.label}</span>
          </Link>
        ))}
      </nav>

      <div className="nav-spacer" />

      <div
        className="card"
        style={{
          padding: 12,
          background: "linear-gradient(180deg, rgba(99,102,241,0.14), rgba(168,85,247,0.08))",
          borderColor: "rgba(99,102,241,0.35)",
        }}
      >
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 4 }}>
          Lookout CI
        </div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Pages smoke green</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
          Last run · 2 min ago
        </div>
      </div>
    </aside>
  );
}
