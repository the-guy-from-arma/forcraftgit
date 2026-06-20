"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { AccessPanel } from "./AccessPanel";
import { Footer } from "./Footer";
import { apiFetch, getToken, logout } from "@/lib/api-client";
import { roleLabel, unitStatusLabels } from "@/lib/roles";
import { useAuth } from "./useAuth";

export function DispatchPortal() {
  const { user, loading, error, allowed } = useAuth("dispatch");
  const [queue, setQueue] = useState<any[]>([]);
  const [dashboard, setDashboard] = useState<any>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!allowed) return;
    void loadAll();

    const socket = io({ auth: { token: getToken() } });
    socketRef.current = socket;
    socket.on("911:incoming", (call) => {
      beep();
      setQueue((current) => [call, ...current.filter((item) => item.id !== call.id)]);
      setAlert(`INCOMING 911: ${call.emergencyType} — ${call.location}`);
    });
    socket.on("911:accepted", ({ callId, cadCall }) => {
      setQueue((current) => current.filter((item) => item.id !== callId));
      setDashboard((current: any) => current && { ...current, calls: [cadCall, ...(current.calls || [])] });
    });
    socket.on("cad:call-created", (call) => {
      setDashboard((current: any) => current && { ...current, calls: [call, ...(current.calls || [])] });
    });
    socket.on("unit:status", () => void loadDashboard());

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [allowed]);

  async function loadAll() {
    await Promise.all([loadQueue(), loadDashboard()]);
  }

  async function loadQueue() {
    const payload = await apiFetch<{ calls: any[] }>("/api/dispatch/queue");
    setQueue(payload.calls);
  }

  async function loadDashboard() {
    const payload = await apiFetch<any>("/api/cad/dashboard");
    setDashboard(payload);
  }

  async function acceptCall(id: string) {
    setFormError(null);
    try {
      await apiFetch(`/api/dispatch/911/${id}/accept`, { method: "POST" });
      setAlert("911 call accepted and converted to CAD incident.");
      await loadAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unable to accept call.");
    }
  }

  async function assignUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch(`/api/cad/calls/${String(form.get("cadCallId"))}/assign`, {
        method: "POST",
        body: { unitId: String(form.get("unitId")) }
      });
      event.currentTarget.reset();
      setAlert("Unit assignment sent to MDT.");
      await loadDashboard();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unable to assign unit.");
    }
  }

  if (!allowed) {
    return <AccessPanel loading={loading} error={error} title="Dispatch console locked" message="Dispatcher access is required." />;
  }

  if (!dashboard) {
    return (
      <main className="dispatch-shell center-screen">
        <div className="terminal-card">Opening FairCroft Communications Center…</div>
      </main>
    );
  }

  return (
    <>
      <main className="dispatch-shell">
        <header className="dispatch-header">
          <div>
            <p className="eyebrow">FairCroft Communications Dispatch</p>
            <h1>Command Center</h1>
            <p>{user?.name} · {roleLabel(user?.role)}</p>
          </div>
          <nav>
            <Link href="/mdt">MDT</Link>
            <Link href="/civilian">PDA</Link>
            <button
              onClick={async () => {
                await logout();
                window.location.href = "/";
              }}
            >
              Sign out
            </button>
          </nav>
        </header>

        {alert && <div className="dispatch-alert">{alert}</div>}
        {formError && <div className="error-strip">{formError}</div>}

        <section className="dispatch-grid">
          <div className="dispatch-card queue-card">
            <div className="card-heading">
              <h2>Incoming 911 Queue</h2>
              <span>{queue.length} waiting</span>
            </div>
            {!queue.length && <p className="muted">No queued 911 calls. Console is standing by.</p>}
            {queue.map((call) => (
              <article className="call-911-card" key={call.id}>
                <div>
                  <strong>{call.emergencyType}</strong>
                  <span>{new Date(call.createdAt).toLocaleTimeString()}</span>
                </div>
                <h3>{call.location}</h3>
                <p>{call.description}</p>
                <small>
                  Caller: {call.callerName} · Callback: {call.callbackNumber}
                </small>
                <button className="button danger" onClick={() => acceptCall(call.id)}>
                  Accept / Create CAD
                </button>
              </article>
            ))}
          </div>

          <div className="dispatch-card">
            <div className="card-heading">
              <h2>Active CAD Incidents</h2>
              <span>{dashboard.calls?.length || 0}</span>
            </div>
            <div className="compact-board">
              {dashboard.calls?.map((call: any) => (
                <article key={call.id}>
                  <strong>{call.callNumber}</strong>
                  <span>{call.priority}</span>
                  <p>{call.type}</p>
                  <small>{call.location}</small>
                </article>
              ))}
            </div>
          </div>

          <div className="dispatch-card">
            <div className="card-heading">
              <h2>Assign Units</h2>
              <span>Live MDT Notify</span>
            </div>
            <form className="stack-form dark-form" onSubmit={assignUnit}>
              <label>
                CAD call
                <select name="cadCallId" required defaultValue="">
                  <option value="" disabled>
                    Select active call
                  </option>
                  {dashboard.calls?.map((call: any) => (
                    <option value={call.id} key={call.id}>
                      {call.callNumber} — {call.type}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Unit
                <select name="unitId" required defaultValue="">
                  <option value="" disabled>
                    Select unit
                  </option>
                  {dashboard.units?.map((unit: any) => (
                    <option value={unit.id} key={unit.id}>
                      {unit.unitNumber} — {unitStatusLabels[unit.status]}
                    </option>
                  ))}
                </select>
              </label>
              <button className="button terminal wide">Assign Unit</button>
            </form>
          </div>

          <div className="dispatch-card">
            <div className="card-heading">
              <h2>Unit Board</h2>
              <span>{dashboard.units?.length || 0} units</span>
            </div>
            <div className="unit-tile-grid">
              {dashboard.units?.map((unit: any) => (
                <div key={unit.id} className="unit-tile">
                  <strong>{unit.unitNumber}</strong>
                  <span>{unitStatusLabels[unit.status]}</span>
                  <small>{unit.department?.code} · {unit.user?.name || "Unstaffed"}</small>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function beep() {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    window.setTimeout(() => {
      oscillator.stop();
      void context.close();
    }, 520);
  } catch {
    // Browser may block audio until interaction; visual alert still fires.
  }
}
