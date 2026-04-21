"use client";

import { useState } from "react";

export default function SettingsPage() {
  const [email, setEmail] = useState("demo@lookout.dev");
  const [saved, setSaved] = useState(false);

  return (
    <main>
      <h1>Settings</h1>
      <label htmlFor="email">Email</label>
      <input id="email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button
        type="button"
        onClick={() => {
          setSaved(true);
        }}
      >
        Save email
      </button>
      {saved ? <p role="status">Saved</p> : null}
    </main>
  );
}
