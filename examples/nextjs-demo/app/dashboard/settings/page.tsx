"use client";

import { useState } from "react";

export default function SettingsPage() {
  const [email, setEmail] = useState("demo@lookout.dev");
  const [workspace, setWorkspace] = useState("Lookout Demo");
  const [weeklyDigest, setWeeklyDigest] = useState(true);
  const [failureAlerts, setFailureAlerts] = useState(true);
  const [saved, setSaved] = useState(false);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="lede">Profile, workspace, and notification preferences.</p>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", alignItems: "start" }}>
        <section className="card card-pad-lg stack" style={{ gap: 14 }}>
          <div>
            <h3 className="card-title" style={{ margin: 0 }}>
              Profile
            </h3>
            <p style={{ color: "var(--text-dim)", marginTop: 4 }}>
              Used for sign-in and runner attribution.
            </p>
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              aria-label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="workspace">Workspace name</label>
            <input
              id="workspace"
              aria-label="Workspace name"
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
            />
          </div>

          <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setEmail("demo@lookout.dev");
                setWorkspace("Lookout Demo");
                setSaved(false);
              }}
            >
              Reset
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setSaved(true);
              }}
            >
              Save email
            </button>
          </div>
          {saved ? (
            <p role="status" className="banner">
              Saved
            </p>
          ) : null}
        </section>

        <section className="card card-pad-lg stack" style={{ gap: 14 }}>
          <div>
            <h3 className="card-title" style={{ margin: 0 }}>
              Notifications
            </h3>
            <p style={{ color: "var(--text-dim)", marginTop: 4 }}>
              Decide what Lookout sends to your inbox.
            </p>
          </div>

          <Toggle
            id="weekly"
            label="Weekly digest"
            description="Every Monday — health, flakes, and runner cost."
            checked={weeklyDigest}
            onChange={setWeeklyDigest}
          />
          <Toggle
            id="failures"
            label="Failure alerts"
            description="Email on verdict = regressions or errors."
            checked={failureAlerts}
            onChange={setFailureAlerts}
          />

          <div className="banner" style={{ marginTop: 6 }}>
            Lookout will never send marketing email. You can silence everything by revoking all API keys.
          </div>
        </section>

        <section
          className="card card-pad-lg stack"
          style={{ gap: 14, gridColumn: "1 / -1", borderColor: "rgba(244,63,94,0.3)" }}
        >
          <div>
            <h3 className="card-title" style={{ margin: 0, color: "#fca5a5" }}>
              Danger zone
            </h3>
            <p style={{ color: "var(--text-dim)", marginTop: 4 }}>
              Destructive actions for the demo workspace. No effect in this demo.
            </p>
          </div>
          <div className="row-between">
            <div>
              <div style={{ fontWeight: 600 }}>Revoke all API keys</div>
              <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
                Immediately invalidates every key in this workspace.
              </p>
            </div>
            <button type="button" className="btn btn-danger">
              Revoke all
            </button>
          </div>
        </section>
      </div>
    </>
  );
}

function Toggle(props: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      htmlFor={props.id}
      className="row-between"
      style={{
        gap: 16,
        padding: "10px 12px",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        background: "rgba(255,255,255,0.02)",
        cursor: "pointer",
      }}
    >
      <span>
        <span style={{ fontWeight: 600 }}>{props.label}</span>
        <span style={{ display: "block", color: "var(--text-dim)", fontSize: 13 }}>
          {props.description}
        </span>
      </span>
      <span
        role="switch"
        aria-checked={props.checked}
        style={{
          width: 36,
          height: 20,
          borderRadius: 999,
          background: props.checked ? "#6366f1" : "var(--bg-3)",
          position: "relative",
          transition: "background 0.15s ease",
          boxShadow: "0 1px 0 rgba(255,255,255,0.06) inset",
        }}
      >
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 2,
            left: props.checked ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: 999,
            background: "white",
            transition: "left 0.15s ease",
          }}
        />
      </span>
      <input
        id={props.id}
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 1, height: 1 }}
      />
    </label>
  );
}
