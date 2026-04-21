export default function DemoA11yBugPage() {
  return (
    <main style={{ padding: 24, maxWidth: 560 }}>
      <h1>Demo — intentional accessibility bug</h1>
      <p>
        This route exists for Lookout’s public showcase: the control below deliberately has no accessible name so
        axe reports a <strong>button-name</strong> violation when checks run.
      </p>
      {/* Intentional: no visible text, no aria-label */}
      <button type="button" />
      <p style={{ marginTop: 24, opacity: 0.8 }}>
        Expected: Lookout records at least one <code>a11y</code> issue after navigating here (see published bundle).
      </p>
    </main>
  );
}
