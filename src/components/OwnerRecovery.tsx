"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, setToken } from "@/lib/api-client";
import { FairCroftSeal } from "./FairCroftSeal";
import { Footer } from "./Footer";

export function OwnerRecovery() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    const form = new FormData(event.currentTarget);

    try {
      const payload = await apiFetch<{ token: string; user: any }>("/api/auth/owner/recovery", {
        method: "POST",
        body: {
          setupToken: String(form.get("setupToken") || ""),
          email: String(form.get("email") || ""),
          password: String(form.get("password") || ""),
          name: String(form.get("name") || "FairCroft Owner")
        }
      });

      setToken(payload.token);
      setMessage("Owner access restored. Opening the admin console...");
      router.push("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Owner recovery failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <main className="home-shell recovery-shell">
        <section className="hero-panel">
          <div className="hero-orbit">
            <FairCroftSeal />
          </div>
          <div>
            <p className="eyebrow">FairCroft CoreOne Recovery</p>
            <h1>Owner Access Reset</h1>
            <p className="hero-copy">
              Protected recovery for Railway deployments. This creates or updates the owner account, verifies the role,
              and signs the owner into the admin console.
            </p>
            <div className="hero-badges">
              <span>Requires Railway Token</span>
              <span>PostgreSQL Owner Reset</span>
              <span>Remove Token After Use</span>
            </div>
          </div>
        </section>

        <section className="auth-card">
          <form className="stack-form" onSubmit={onSubmit}>
            <p className="eyebrow">Emergency Owner Recovery</p>
            <h2>Restore owner login</h2>
            <p className="hint">
              Set <code>OWNER_SETUP_TOKEN</code> in Railway first. After this works, remove that variable.
            </p>
            <label>
              Recovery token
              <input name="setupToken" type="password" placeholder="OWNER_SETUP_TOKEN" required />
            </label>
            <label>
              Owner email
              <input name="email" type="email" placeholder="owner@faircroft.local" required />
            </label>
            <label>
              Owner display name
              <input name="name" placeholder="FairCroft Owner" />
            </label>
            <label>
              New owner password
              <input name="password" type="password" minLength={10} required />
            </label>
            {error && <p className="form-error">{error}</p>}
            {message && <p className="form-success">{message}</p>}
            <button type="submit" className="button primary wide" disabled={busy}>
              {busy ? "Restoring owner..." : "Reset Owner Access"}
            </button>
            <Link href="/login" className="button ghost wide">
              Return to login
            </Link>
          </form>
        </section>
      </main>
      <Footer />
    </>
  );
}
