import Link from "next/link";
import { Sparkline } from "./_components/sparkline";

type Kpi = {
  label: string;
  value: string;
  delta: string;
  direction: "up" | "down";
  data: number[];
  color: string;
};

const kpis: Kpi[] = [
  {
    label: "Requests",
    value: "128.4k",
    delta: "+12.8% vs last 7d",
    direction: "up",
    data: [12, 14, 15, 13, 18, 22, 24, 26, 25, 28, 31, 35, 34, 38],
    color: "#a5b4fc",
  },
  {
    label: "Success rate",
    value: "99.93%",
    delta: "+0.04% vs last 7d",
    direction: "up",
    data: [99.7, 99.8, 99.82, 99.9, 99.85, 99.92, 99.95, 99.93],
    color: "#7ee7a0",
  },
  {
    label: "p95 latency",
    value: "184 ms",
    delta: "−22 ms vs last 7d",
    direction: "up",
    data: [260, 240, 230, 220, 215, 210, 198, 192, 188, 184],
    color: "#22d3ee",
  },
  {
    label: "Active keys",
    value: "7",
    delta: "+1 this week",
    direction: "up",
    data: [4, 4, 4, 5, 5, 6, 6, 6, 7],
    color: "#f0abfc",
  },
];

type Activity = {
  at: string;
  who: string;
  action: string;
  target: string;
};

const activity: Activity[] = [
  { at: "just now", who: "demo@lookout.dev", action: "signed in from", target: "127.0.0.1" },
  { at: "2m ago", who: "Lookout CI", action: "published pages for", target: "v0.5.3 / latest" },
  { at: "14m ago", who: "demo@lookout.dev", action: "rotated key", target: "lk_prod_core" },
  { at: "1h ago", who: "Lookout runner", action: "completed smoke run", target: "report · 14s · clean" },
  { at: "3h ago", who: "demo@lookout.dev", action: "updated", target: "notification preferences" },
  { at: "yesterday", who: "Lookout runner", action: "recorded a11y issue on", target: "/demo-a11y-bug" },
];

export default function Dashboard() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Overview</h1>
          <p className="lede">
            A single pane for the last seven days of the demo workspace — traffic, reliability, and agent
            activity.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link href="/dashboard/keys/new" className="btn btn-primary">
            <span aria-hidden>+</span> New key
          </Link>
          <Link href="/dashboard/settings" className="btn">
            Settings
          </Link>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        {kpis.map((k) => (
          <div key={k.label} className="card kpi">
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value">{k.value}</div>
            <div className={`kpi-delta ${k.direction === "up" ? "delta-up" : "delta-down"}`}>
              <span aria-hidden>{k.direction === "up" ? "↑" : "↓"}</span>
              <span style={{ color: "var(--text-muted)" }}>{k.delta}</span>
            </div>
            <div style={{ marginTop: 12 }}>
              <Sparkline data={k.data} stroke={k.color} ariaLabel={`${k.label} trend`} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.2fr 1fr", alignItems: "start" }}>
        <div className="card card-pad-lg">
          <div className="row-between">
            <div>
              <h3 className="card-title" style={{ margin: 0 }}>
                Request volume
              </h3>
              <div style={{ marginTop: 4, color: "var(--text-dim)", fontSize: 13 }}>
                Rolling 24h, sampled every 15 min
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <span className="badge">24h</span>
              <span className="badge badge-brand">7d</span>
              <span className="badge">30d</span>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <Sparkline
              data={[12, 14, 15, 13, 18, 16, 22, 24, 21, 26, 25, 28, 31, 35, 34, 38, 41, 39, 42, 46, 44]}
              height={160}
              stroke="#a5b4fc"
              ariaLabel="Request volume chart"
            />
          </div>
          <div className="row" style={{ gap: 24, marginTop: 12, flexWrap: "wrap" }}>
            <Legend color="#a5b4fc" label="Success" value="127.6k" />
            <Legend color="#fbbf24" label="Throttled" value="642" />
            <Legend color="#fca5a5" label="Errors" value="88" />
          </div>
        </div>

        <div className="card card-pad-lg">
          <div className="row-between">
            <h3 className="card-title" style={{ margin: 0 }}>
              Recent activity
            </h3>
            <span className="badge">live</span>
          </div>
          <div className="feed" style={{ marginTop: 8 }}>
            {activity.map((a, i) => (
              <div key={i} className="feed-item">
                <div className="feed-icon" aria-hidden>
                  {a.who.startsWith("Lookout") ? "◉" : "D"}
                </div>
                <div>
                  <div className="feed-text">
                    <strong style={{ color: "var(--text)" }}>{a.who}</strong>{" "}
                    <span style={{ color: "var(--text-dim)" }}>{a.action}</span>{" "}
                    <span style={{ color: "var(--text)" }}>{a.target}</span>
                  </div>
                </div>
                <div className="feed-meta">{a.at}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="row" style={{ gap: 8, fontSize: 13 }}>
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: 3,
          background: color,
          boxShadow: "0 0 0 3px rgba(255,255,255,0.03)",
        }}
      />
      <span style={{ color: "var(--text-dim)" }}>{label}</span>
      <span style={{ color: "var(--text)", fontWeight: 600 }}>{value}</span>
    </div>
  );
}
