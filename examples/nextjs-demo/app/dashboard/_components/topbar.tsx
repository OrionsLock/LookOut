"use client";

import { usePathname } from "next/navigation";

function crumbs(pathname: string | null): string[] {
  if (!pathname) return ["Dashboard"];
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "dashboard") return ["Dashboard"];
  return parts.map((p, i) => (i === 0 ? "Dashboard" : p.replace(/-/g, " ")));
}

export function Topbar() {
  const path = usePathname();
  const trail = crumbs(path);
  const last = trail[trail.length - 1] ?? "Dashboard";
  return (
    <header className="shell-topbar">
      <div className="crumbs" aria-label="Breadcrumb">
        {trail.slice(0, -1).map((c) => (
          <span key={c} style={{ textTransform: "capitalize" }}>
            {c} <span style={{ color: "var(--text-muted)" }}>/</span>{" "}
          </span>
        ))}
        <span style={{ textTransform: "capitalize" }}>{last}</span>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <span className="badge badge-success">
          <span className="dot" />
          Live
        </span>
        <div
          aria-label="User"
          title="demo@lookout.dev"
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            display: "grid",
            placeItems: "center",
            background:
              "conic-gradient(from 120deg at 50% 50%, #6366f1, #a855f7, #22d3ee, #6366f1)",
            color: "white",
            fontWeight: 700,
            fontSize: 12,
          }}
        >
          D
        </div>
      </div>
    </header>
  );
}
