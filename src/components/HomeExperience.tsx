"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, login, setToken } from "@/lib/api-client";
import { canUseAdmin, canUseDispatch, canUseMdt, roleLabel } from "@/lib/roles";
import { FairCroftSeal } from "./FairCroftSeal";
import { Footer } from "./Footer";

type Mode = "login" | "register";

export function HomeExperience() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);

  async function onLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    try {
      const payload = await login(String(form.get("email")), String(form.get("password")));
      setUser(payload.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to log in.");
    } finally {
      setBusy(false);
    }
  }

  async function onRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    try {
      const payload = await apiFetch<{ token: string; user: any }>("/api/auth/register", {
        method: "POST",
        body: {
          email: String(form.get("email")),
          password: String(form.get("password")),
          firstName: String(form.get("firstName")),
          lastName: String(form.get("lastName")),
          phone: String(form.get("phone")),
          dateOfBirth: String(form.get("dateOfBirth")),
          address: String(form.get("address")),
          city: "FairCroft",
          state: "FC",
          postalCode: String(form.get("postalCode"))
        }
      });
      setToken(payload.token);
      setUser(payload.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to register.");
    } finally {
      setBusy(false);
    }
  }

  function continueToBestPortal() {
    if (canUseAdmin(user?.role)) router.push("/admin");
    else if (canUseDispatch(user?.role)) router.push("/dispatch");
    else if (canUseMdt(user?.role)) router.push("/mdt");
    else router.push("/civilian");
  }

  return (
    <>
      <main className="home-shell">
        <section className="hero-panel">
          <div className="hero-orbit">
            <FairCroftSeal />
          </div>
          <div>
            <p className="eyebrow">FairCroft Government Services</p>
            <h1>CoreOne Roleplay CAD/MDT</h1>
            <p className="hero-copy">
              A fictional public-safety operating system for civilian services, department applications, command
              dispatch, and live MDT workflows.
            </p>
            <div className="hero-badges">
              <span>Roleplay Safe</span>
              <span>Socket.IO Live CAD</span>
              <span>Railway Ready</span>
            </div>
          </div>
        </section>

        <section className="auth-card">
          {user ? (
            <div className="session-card">
              <p className="eyebrow">Session Active</p>
              <h2>{user.name}</h2>
              <p>
                Authenticated as <strong>{roleLabel(user.role)}</strong>. Choose your active workstation.
              </p>
              <div className="portal-grid">
                <Link href="/civilian" className="portal-card">
                  <span>📱</span>
                  <strong>Civilian PDA</strong>
                  <small>Government services and applications</small>
                </Link>
                {canUseMdt(user.role) && (
                  <Link href="/mdt" className="portal-card">
                    <span>▣</span>
                    <strong>Department MDT</strong>
                    <small>Calls, units, BOLOs, reports</small>
                  </Link>
                )}
                {canUseDispatch(user.role) && (
                  <Link href="/dispatch" className="portal-card">
                    <span>☎</span>
                    <strong>Dispatch Center</strong>
                    <small>911 queue and assignments</small>
                  </Link>
                )}
                {canUseAdmin(user.role) && (
                  <Link href="/admin" className="portal-card">
                    <span>⚙</span>
                    <strong>Admin Console</strong>
                    <small>Approvals, roles, audit logs</small>
                  </Link>
                )}
              </div>
              <button className="button primary wide" onClick={continueToBestPortal}>
                Continue
              </button>
            </div>
          ) : (
            <>
              <div className="auth-toggle">
                <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
                  Login
                </button>
                <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
                  Register
                </button>
              </div>

              {mode === "login" ? (
                <form className="stack-form" onSubmit={onLogin}>
                  <p className="eyebrow">Secure Roleplay Access</p>
                  <h2>Sign in to CoreOne</h2>
                  <label>
                    Email
                    <input name="email" type="email" placeholder="owner@faircroft.local" required />
                  </label>
                  <label>
                    Password
                    <input name="password" type="password" placeholder="••••••••" required />
                  </label>
                  {error && <p className="form-error">{error}</p>}
                  <button className="button primary wide" disabled={busy}>
                    {busy ? "Authenticating…" : "Enter CoreOne"}
                  </button>
                  <p className="hint">
                    Seed owner: <code>owner@faircroft.local</code> / <code>ChangeMe123!</code>
                  </p>
                </form>
              ) : (
                <form className="stack-form" onSubmit={onRegister}>
                  <p className="eyebrow">Civilian Enrollment</p>
                  <h2>Create a PDA account</h2>
                  <div className="two-col">
                    <label>
                      First name
                      <input name="firstName" required />
                    </label>
                    <label>
                      Last name
                      <input name="lastName" required />
                    </label>
                  </div>
                  <label>
                    Email
                    <input name="email" type="email" required />
                  </label>
                  <label>
                    Password
                    <input name="password" type="password" minLength={8} required />
                  </label>
                  <div className="two-col">
                    <label>
                      Phone
                      <input name="phone" />
                    </label>
                    <label>
                      Date of birth
                      <input name="dateOfBirth" type="date" />
                    </label>
                  </div>
                  <label>
                    Address
                    <input name="address" placeholder="Street address" />
                  </label>
                  <label>
                    Postal code
                    <input name="postalCode" />
                  </label>
                  {error && <p className="form-error">{error}</p>}
                  <button className="button primary wide" disabled={busy}>
                    {busy ? "Creating…" : "Create Civilian Account"}
                  </button>
                </form>
              )}
            </>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
