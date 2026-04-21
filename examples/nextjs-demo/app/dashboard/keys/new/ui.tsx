"use client";

import { useMemo, useState } from "react";

export function CreateKeyForm({ seedBug }: { seedBug: boolean }) {
  const [name, setName] = useState("test");
  const [env, setEnv] = useState<"production" | "staging" | "development">("development");
  const [key, setKey] = useState<string | null>(null);

  const slug = useMemo(
    () =>
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "unnamed",
    [name],
  );

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const token = `lk_${env.slice(0, 4)}_${slug}_${Math.random().toString(36).slice(2, 8)}`;
        setKey(token);
      }}
    >
      <div className="field">
        <label htmlFor="keyname">Key name</label>
        <input
          id="keyname"
          aria-label="Key name"
          placeholder="e.g. prod-core"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <span className="hint">
          Preview: <code>lk_{env.slice(0, 4)}_{slug}_…</code>
        </span>
      </div>

      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ padding: 0, fontSize: 12, color: "var(--text-dim)" }}>Environment</legend>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {(["production", "staging", "development"] as const).map((opt) => {
            const active = env === opt;
            return (
              <button
                key={opt}
                type="button"
                className={active ? "btn btn-primary btn-sm" : "btn btn-sm"}
                aria-pressed={active}
                onClick={() => setEnv(opt)}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </fieldset>

      {seedBug ? (
        <button type="button" role="button" name="Create key" className="btn btn-primary">
          Create key
        </button>
      ) : (
        <button type="submit" role="button" name="Create key" className="btn btn-primary">
          Create key
        </button>
      )}

      {key ? (
        <div role="status" className="banner">
          <div className="stack" style={{ gap: 6 }}>
            <div>
              Created: <code style={{ color: "var(--text)" }}>{key}</code>
            </div>
            <span className="hint">Store this token — it will not be shown again.</span>
          </div>
        </div>
      ) : null}
    </form>
  );
}
