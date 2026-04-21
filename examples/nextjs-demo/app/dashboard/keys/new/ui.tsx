"use client";

import { useState } from "react";

export function CreateKeyForm({ seedBug }: { seedBug: boolean }) {
  const [name, setName] = useState("test");
  const [key, setKey] = useState<string | null>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setKey(`lk_${name}_mock`);
      }}
    >
      <label htmlFor="keyname">Key name</label>
      <input id="keyname" aria-label="Key name" value={name} onChange={(e) => setName(e.target.value)} />
      {seedBug ? (
        <button type="button" role="button" name="Create key">
          Create key
        </button>
      ) : (
        <button type="submit" role="button" name="Create key">
          Create key
        </button>
      )}
      {key ? <p role="status">Created: {key}</p> : null}
    </form>
  );
}
