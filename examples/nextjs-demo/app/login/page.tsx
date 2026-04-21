"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("demo@lookout.dev");
  const [password, setPassword] = useState("lookout123");
  const [error, setError] = useState<string | null>(null);

  return (
    <main>
      <h1>Sign in</h1>
      <form
        role="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
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
        }}
      >
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" aria-label="Email" value={email} onChange={(ev) => setEmail(ev.target.value)} />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            aria-label="Password"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
          />
        </div>
        <button type="submit">Sign in</button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}
