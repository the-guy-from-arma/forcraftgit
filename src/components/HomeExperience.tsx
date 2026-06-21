"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, login, setToken } from "@/lib/api-client";
import { canUseAdmin, canUseDispatch, canUseGovernment, canUseMdt, roleLabel } from "@/lib/roles";
import { FairCroftSeal } from "./FairCroftSeal";
import { Footer } from "./Footer";
import { PhotoDropzone } from "./PhotoDropzone";

type Mode = "login" | "register";

function bestPortalForRole(role?: string) {
  if (canUseAdmin(role)) return "/admin";
  if (canUseDispatch(role)) return "/dispatch";
  if (canUseMdt(role)) return "/mdt";
  if (canUseGovernment(role)) return "/government";
  return "/civilian";
}

export function HomeExperience({ initialMode = "login" }: { initialMode?: Mode } = {}) {
  const router = useRouter();
  const mode = initialMode;
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
      router.push(bestPortalForRole(payload.user?.role));
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
          postalCode: String(form.get("postalCode")),
          characterPhotoUrl: String(form.get("characterPhotoUrl")),
          characterPhotoNoticeAccepted: form.get("characterPhotoNoticeAccepted") === "on"
        }
      });
      setToken(payload.token);
      setUser(payload.user);
      router.push("/civilian");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to register.");
    } finally {
      setBusy(false);
    }
  }

  function continueToBestPortal() {
    router.push(bestPortalForRole(user?.role));
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
              A fictional public-safety operating system for civilian services, DMV records, department jobs, command
              dispatch, and live MDT workflows.
            </p>
            <div className="hero-badges">
              <span>Roleplay Safe</span>
              <span>Socket.IO Live CAD</span>
              <span>Railway / Docker Ready</span>
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
                  <span>PDA</span>
                  <strong>Civilian PDA</strong>
                  <small>DMV, passport, vehicles, and applications</small>
                </Link>
                {canUseMdt(user.role) && (
                  <Link href="/mdt" className="portal-card">
                    <span>MDT</span>
                    <strong>Department MDT</strong>
                    <small>Calls, units, BOLOs, reports</small>
                  </Link>
                )}
                {canUseDispatch(user.role) && (
                  <Link href="/dispatch" className="portal-card">
                    <span>911</span>
                    <strong>Dispatch Center</strong>
                    <small>911 queue and assignments</small>
                  </Link>
                )}
                {canUseGovernment(user.role) && (
                  <Link href="/government" className="portal-card">
                    <span>GOV</span>
                    <strong>Government OS</strong>
                    <small>DMV approvals and civilian records</small>
                  </Link>
                )}
                {canUseAdmin(user.role) && (
                  <Link href="/admin" className="portal-card">
                    <span>ADM</span>
                    <strong>Admin Console</strong>
                    <small>Jobs, roles, audit logs, server control</small>
                  </Link>
                )}
              </div>
              <button type="button" className="button primary wide" onClick={continueToBestPortal}>
                Continue
              </button>
            </div>
          ) : (
            <>
              <div className="auth-toggle">
                <Link href="/login" className={mode === "login" ? "active" : ""}>
                  Login
                </Link>
                <Link href="/register" className={mode === "register" ? "active" : ""}>
                  Register
                </Link>
              </div>

              {mode === "login" ? (
                <form className="stack-form" onSubmit={onLogin}>
                  <p className="eyebrow">Secure Roleplay Access</p>
                  <h2>Sign in to CoreOne</h2>
                  <label>
                    Email
                    <input name="email" type="email" placeholder="name@example.com" required />
                  </label>
                  <label>
                    Password
                    <input name="password" type="password" placeholder="Password" required />
                  </label>
                  {error && <p className="form-error">{error}</p>}
                  <button type="submit" className="button primary wide" disabled={busy}>
                    {busy ? "Authenticating..." : "Enter CoreOne"}
                  </button>
                </form>
              ) : (
                <form className="stack-form" onSubmit={onRegister}>
                  <p className="eyebrow">Civilian Enrollment</p>
                  <h2>Create an unverified civilian PDA</h2>
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
                  <PhotoDropzone name="characterPhotoUrl" label="Character / passport photo" />
                  <label className="checkline fine-print">
                    <input name="characterPhotoNoticeAccepted" type="checkbox" /> I understand profile photos must be fictional/game-character images.
                  </label>
                  {error && <p className="form-error">{error}</p>}
                  <button type="submit" className="button primary wide" disabled={busy}>
                    {busy ? "Creating..." : "Create Unverified Civilian Account"}
                  </button>
                  <p className="hint">After creation, open your PDA DMV/passport app to request verification, license, and vehicle records.</p>
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
