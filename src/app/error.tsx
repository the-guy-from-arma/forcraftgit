"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="center-screen">
      <section className="glass-panel access-panel">
        <p className="eyebrow">FairCroft CoreOne</p>
        <h1>Website panel failed to load</h1>
        <p className="muted">
          The CoreOne website hit a client-side loading error. This is a website PWA issue, not a native iPhone app
          install.
        </p>
        <p className="form-error">{error.message || "Unknown loading error."}</p>
        <button className="button primary" onClick={reset}>
          Reload Panel
        </button>
      </section>
    </main>
  );
}
