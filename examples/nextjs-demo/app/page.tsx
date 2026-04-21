import Link from "next/link";

export default function Home() {
  return (
    <main className="hero">
      <div className="hero-inner">
        <span className="hero-eyebrow">
          <span className="brand-mark" aria-hidden="true" style={{ width: 16, height: 16, fontSize: 9 }}>
            L
          </span>
          Lookout demo app · Next.js 15
        </span>
        <h1 className="hero-title">AI-assisted QA for real web apps.</h1>
        <p className="hero-lede">
          This demo is the surface the Lookout crawler drives in CI: a realistic sign-in, API keys, settings,
          and an intentional a11y bug for the public showcase bundle.
        </p>
        <div className="hero-cta">
          <Link className="btn btn-primary" href="/login">
            Sign in to the demo
            <span aria-hidden>→</span>
          </Link>
          <Link className="btn" href="/demo-a11y-bug">
            View a11y showcase
          </Link>
        </div>
        <div className="hero-chips" aria-label="Capabilities">
          <span>Playwright driver</span>
          <span>Axe checks</span>
          <span>LLM plan/act loop</span>
          <span>Golden screenshots</span>
          <span>MCP server</span>
          <span>Trace on failure</span>
        </div>
      </div>
    </main>
  );
}
