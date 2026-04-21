import Link from "next/link";

type Key = {
  id: string;
  name: string;
  prefix: string;
  env: "production" | "staging" | "development";
  lastUsed: string;
  createdAt: string;
  status: "active" | "idle" | "revoked";
};

const seed: Key[] = [
  {
    id: "k_1",
    name: "prod-core",
    prefix: "lk_prod_****n4",
    env: "production",
    lastUsed: "just now",
    createdAt: "2026-04-01",
    status: "active",
  },
  {
    id: "k_2",
    name: "prod-edge",
    prefix: "lk_prod_****7a",
    env: "production",
    lastUsed: "2 min ago",
    createdAt: "2026-03-22",
    status: "active",
  },
  {
    id: "k_3",
    name: "staging-ci",
    prefix: "lk_stag_****b2",
    env: "staging",
    lastUsed: "1 hour ago",
    createdAt: "2026-03-15",
    status: "active",
  },
  {
    id: "k_4",
    name: "playground",
    prefix: "lk_dev_****zp",
    env: "development",
    lastUsed: "3 days ago",
    createdAt: "2026-02-28",
    status: "idle",
  },
  {
    id: "k_5",
    name: "retired-mar",
    prefix: "lk_prod_****qq",
    env: "production",
    lastUsed: "2 weeks ago",
    createdAt: "2025-11-02",
    status: "revoked",
  },
];

function envBadge(env: Key["env"]) {
  if (env === "production") return <span className="badge badge-brand">prod</span>;
  if (env === "staging") return <span className="badge badge-warning">staging</span>;
  return <span className="badge">dev</span>;
}

function statusBadge(status: Key["status"]) {
  if (status === "active")
    return (
      <span className="badge badge-success">
        <span className="dot" />
        Active
      </span>
    );
  if (status === "idle") return <span className="badge">Idle</span>;
  return <span className="badge badge-danger">Revoked</span>;
}

export default function KeysPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>API Keys</h1>
          <p className="lede">Rotate and revoke keys used by Lookout runners and CI.</p>
        </div>
        <Link href="/dashboard/keys/new" className="btn btn-primary">
          <span aria-hidden>+</span> Create new key
        </Link>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="table" aria-label="API keys">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Token</th>
              <th scope="col">Env</th>
              <th scope="col">Last used</th>
              <th scope="col">Created</th>
              <th scope="col">Status</th>
              <th scope="col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {seed.map((k) => (
              <tr key={k.id}>
                <td style={{ fontWeight: 600 }}>{k.name}</td>
                <td className="mono" style={{ color: "var(--text-dim)" }}>
                  {k.prefix}
                </td>
                <td>{envBadge(k.env)}</td>
                <td style={{ color: "var(--text-dim)" }}>{k.lastUsed}</td>
                <td style={{ color: "var(--text-dim)" }}>{k.createdAt}</td>
                <td>{statusBadge(k.status)}</td>
                <td style={{ textAlign: "right" }}>
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={`Manage ${k.name}`}>
                    Manage
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
