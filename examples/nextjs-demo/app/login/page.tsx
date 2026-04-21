"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("demo@lookout.dev");
  const [password, setPassword] = useState("lookout123");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <main className="auth-split">
      <aside className="auth-aside">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            L
          </span>
          <span>Lookout</span>
        </div>
        <div className="stack" style={{ gap: 20, maxWidth: 460 }}>
          <span className="tag">Lookout demo</span>
          <h2>A realistic SaaS surface, engineered for deterministic QA.</h2>
          <p className="quote">
            “Lookout drives this demo end-to-end in CI: sign-in, API key creation, settings, and a curated
            a11y showcase — all from a mock LLM plan.”
          </p>
        </div>
        <div className="row" style={{ gap: 8, color: "var(--text-muted)", fontSize: 12 }}>
          <span>v0.5</span>
          <span>·</span>
          <span>MIT</span>
          <span>·</span>
          <span>Playwright + Axe + LLM</span>
        </div>
      </aside>
      <section className="auth-main">
        <div className="auth-card card card-pad-lg stack" style={{ gap: 18 }}>
          <div className="stack" style={{ gap: 6 }}>
            <h1 style={{ fontSize: 22 }}>Sign in</h1>
            <p className="hint">Use the pre-filled demo credentials to continue.</p>
          </div>

          <form
            role="form"
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              setPending(true);
              try {
                const res = await fetch("/api/login", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ email, password }),
                });
                if (!res.ok) {
                  setError("Invalid credentials");
                  return;
                }
                router.push("/dashboard");
              } finally {
                setPending(false);
              }
            }}
          >
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                aria-label="Email"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-label="Password"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
              {pending ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="auth-demo" aria-label="Demo credentials">
            <strong>Email</strong>
            <code>demo@lookout.dev</code>
            <strong>Password</strong>
            <code>lookout123</code>
          </div>

          {error ? (
            <p role="alert" className="banner banner-danger">
              {error}
            </p>
          ) : null}

          <p className="hint" style={{ textAlign: "center" }}>
            No account —{" "}
            <Link href="/" style={{ color: "var(--text)" }}>
              back to landing
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
