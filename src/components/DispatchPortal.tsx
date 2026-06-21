"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
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

  const loadQueue = useCallback(async () => {
    const payload = await apiFetch<{ calls: any[] }>("/api/dispatch/queue");
    setQueue(payload.calls);
  }, []);

  const loadDashboard = useCallback(async () => {
    const payload = await apiFetch<any>("/api/cad/dashboard");
    setDashboard(payload);
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadQueue(), loadDashboard()]);
  }, [loadDashboard, loadQueue]);

  useEffect(() => {
    if (!allowed) return;
    const timer = window.setTimeout(() => void loadAll(), 0);
    const socket = io({ auth: { token: getToken() } });

    socket.on("911:incoming", (call) => {
      beep();
      setQueue((current) => [call, ...current.filter((item) => item.id !== call.id)]);
      setAlert(`INCOMING 911: ${call.emergencyType} - ${call.location}`);
    });
    socket.on("911:accepted", ({ callId, cadCall, autoRouted }) => {
      setQueue((current) => current.filter((item) => item.id !== callId));
      setDashboard((current: any) => current && { ...current, calls: [cadCall, ...(current.calls || [])] });
      if (autoRouted) setAlert(`911 auto-routed to first available on-shift unit: ${cadCall?.callNumber}`);
    });
    socket.on("cad:call-created", (call) => {
      setDashboard((current: any) => current && { ...current, calls: [call, ...(current.calls || [])] });
    });
    socket.on("unit:status", () => void loadDashboard());

    return () => {
      window.clearTimeout(timer);
      socket.disconnect();
    };
  }, [allowed, loadAll, loadDashboard]);

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
        <div className="terminal-card">Opening FairCroft Communications Center...</div>
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
            <p>{user?.name} / {roleLabel(user?.role)}</p>
          </div>
          <nav>
            <Link href="/mdt">MDT</Link>
            <Link href="/government">Government OS</Link>
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
                  Caller: {call.callerName} / Callback: {call.callbackNumber}
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
                    <option key={call.id} value={call.id}>
                      {call.callNumber} - {call.type}
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
                    <option key={unit.id} value={unit.id}>
                      {unit.unitNumber} - {unitStatusLabels[unit.status]}
                    </option>
                  ))}
                </select>
              </label>
              <button className="button terminal">Assign Unit</button>
            </form>
          </div>

          <div className="dispatch-card">
            <div className="card-heading">
              <h2>Unit Board</h2>
              <span>{dashboard.units?.length || 0} units</span>
            </div>
            <div className="unit-tile-grid">
              {dashboard.units?.map((unit: any) => (
                <div className="unit-tile" key={unit.id}>
                  <strong>{unit.unitNumber}</strong>
                  <span>{unitStatusLabels[unit.status]}</span>
                  <small>{unit.user?.name || "Unstaffed"}</small>
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
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audio = new AudioContextClass();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = 920;
    oscillator.type = "square";
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    window.setTimeout(() => {
      oscillator.stop();
      void audio.close();
    }, 420);
  } catch {
    // Browser autoplay policies can block audio; the visual alert remains active.
  }
}
