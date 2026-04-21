import Link from "next/link";

export default function DemoA11yBugPage() {
  return (
    <main className="container">
      <div className="row" style={{ marginBottom: 16 }}>
        <Link href="/" className="btn btn-ghost btn-sm">
          <span aria-hidden>←</span> Home
        </Link>
        <span className="badge badge-danger">intentional</span>
      </div>
      <div className="card card-pad-lg stack" style={{ gap: 14, maxWidth: 720 }}>
        <h1>Demo — intentional accessibility bug</h1>
        <p>
          This route exists for Lookout’s public showcase: the control below deliberately has no accessible
          name so axe reports a <code>button-name</code> violation when checks run.
        </p>
        <div className="row" style={{ gap: 12, alignItems: "center" }}>
          {/* Intentional: no visible text, no aria-label — do not "fix" this. */}
          <button type="button" className="a11y-demo-btn" />
          <span className="hint">Above: the button deliberately missing an accessible name.</span>
        </div>
        <p className="hint">
          Expected: Lookout records at least one <code>a11y</code> issue after navigating here (see the
          published bundle at <code>/examples/find-the-bug/</code>).
        </p>
      </div>
    </main>
  );
}
