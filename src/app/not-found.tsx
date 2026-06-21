import Link from "next/link";

export default function NotFound() {
  return (
    <main className="center-screen">
      <section className="glass-panel access-panel">
        <p className="eyebrow">FairCroft CoreOne</p>
        <h1>Workstation not found</h1>
        <p>The requested FairCroft module does not exist or is not available from this roleplay server.</p>
        <Link className="button primary" href="/">
          Return to CoreOne
        </Link>
      </section>
    </main>
  );
}
