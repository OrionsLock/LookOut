import Link from "next/link";

export default function Dashboard() {
  return (
    <main>
      <h1>Dashboard</h1>
      <ul>
        <li>
          <Link href="/dashboard/keys">Keys</Link>
        </li>
        <li>
          <Link href="/dashboard/settings">Settings</Link>
        </li>
      </ul>
    </main>
  );
}
