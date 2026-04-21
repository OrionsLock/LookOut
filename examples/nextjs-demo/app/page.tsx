import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>Lookout Next.js demo</h1>
      <p>
        <Link href="/login">Sign in</Link>
      </p>
    </main>
  );
}
