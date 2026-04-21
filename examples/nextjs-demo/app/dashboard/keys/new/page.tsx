import { CreateKeyForm } from "./ui";

export default function NewKeyPage() {
  const seedBug = process.env.SEED_BUG === "1";
  return (
    <main>
      <h1>Create key</h1>
      <CreateKeyForm seedBug={seedBug} />
    </main>
  );
}
