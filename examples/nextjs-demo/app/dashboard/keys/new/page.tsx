import Link from "next/link";
import { CreateKeyForm } from "./ui";

export default function NewKeyPage() {
  const seedBug = process.env.SEED_BUG === "1";
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Create key</h1>
          <p className="lede">
            Generate a new API key. Names are not secret — pick something human-readable for logs.
          </p>
        </div>
        <Link href="/dashboard/keys" className="btn btn-ghost">
          <span aria-hidden>←</span> All keys
        </Link>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.3fr 1fr", alignItems: "start" }}>
        <div className="card card-pad-lg">
          <CreateKeyForm seedBug={seedBug} />
        </div>
        <div className="card card-pad-lg stack" style={{ gap: 12 }}>
          <h3 className="card-title" style={{ margin: 0 }}>
            Scopes &amp; safety
          </h3>
          <p style={{ color: "var(--text-dim)" }}>
            Keys inherit the workspace’s default scopes. In this demo every key is read-only and never leaves
            the browser — form submission generates a mock token prefixed with <code>lk_</code>.
          </p>
          <ul className="stack" style={{ gap: 8, paddingLeft: 18, color: "var(--text-dim)" }}>
            <li>Stored as HMAC(sha-256) on the server (mocked in this demo).</li>
            <li>Shown once after creation — copy then store in a secret manager.</li>
            <li>Rotate quarterly or after any suspected exposure.</li>
          </ul>
          {seedBug ? (
            <p className="banner banner-danger">
              <strong>SEED_BUG</strong>&nbsp;is on — the Create key button is intentionally a non-submit for
              the demo/eval harness.
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}
