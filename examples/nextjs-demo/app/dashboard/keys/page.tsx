import Link from "next/link";

export default function KeysPage() {
  return (
    <main>
      <h1>API Keys</h1>
      <p>
        <Link href="/dashboard/keys/new">Create new key</Link>
      </p>
    </main>
  );
}
