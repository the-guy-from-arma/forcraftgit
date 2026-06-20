"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { AccessPanel } from "./AccessPanel";
import { Footer } from "./Footer";
import { apiFetch, getToken, logout } from "@/lib/api-client";
import { canUseAdmin, canUseDispatch, canUseMdt, roleLabel } from "@/lib/roles";
import { useAuth } from "./useAuth";

const govApps = ["DMV Queue", "Identity Search", "Approved Records", "Denied Records", "My Desk"] as const;
type GovApp = (typeof govApps)[number];

export function GovernmentPortal() {
  const { user, loading, error, allowed } = useAuth("government");
  const [activeApp, setActiveApp] = useState<GovApp>("DMV Queue");
  const [applications, setApplications] = useState<any[]>([]);
  const [searchResults, setSearchResults] = useState<any>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const payload = await apiFetch<{ applications: any[] }>("/api/government/dmv-applications");
    setApplications(payload.applications);
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const timer = window.setTimeout(() => void load(), 0);
    const socket = io({ auth: { token: getToken() } });
    socket.on("government:application", (application) => {
      setApplications((current) => [application, ...current]);
      setNotice(`New government application: ${application.type}`);
    });
    socket.on("government:application-decision", (application) => {
      setApplications((current) => current.map((item) => (item.id === application.id ? application : item)));
    });
    return () => {
      window.clearTimeout(timer);
      socket.disconnect();
    };
  }, [allowed, load]);

  async function decide(id: string, decision: "approved" | "denied") {
    setNotice(null);
    setFormError(null);
    try {
      await apiFetch(`/api/government/dmv-applications/${id}/decision`, {
        method: "POST",
        body: { decision, reason: reasons[id] || "" }
      });
      setNotice(`Application ${decision}.`);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Decision failed.");
    }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setFormError(null);
    const form = new FormData(event.currentTarget);
    try {
      const payload = await apiFetch<any>(`/api/government/records/search?q=${encodeURIComponent(String(form.get("q") || ""))}`);
      setSearchResults(payload);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Search failed.");
    }
  }

  if (!allowed) {
    return <AccessPanel loading={loading} error={error} title="Government OS locked" message="Government employee, dispatcher, admin, or owner role required." />;
  }

  const filtered =
    activeApp === "Approved Records"
      ? applications.filter((application) => application.status === "approved")
      : activeApp === "Denied Records"
        ? applications.filter((application) => application.status === "denied")
        : applications.filter((application) => application.status === "pending");

  return (
    <>
      <main className="government-shell">
        <header className="government-topbar">
          <div>
            <p className="eyebrow">FairCroft Government Services</p>
            <h1>Government OS</h1>
            <p>{user?.name} / {roleLabel(user?.role)}</p>
          </div>
          <div className="terminal-status">
            <span className="live-dot" />
            DMV QUEUE LIVE
          </div>
          <div className="floating-actions">
            <Link href="/civilian">PDA</Link>
            {canUseMdt(user?.role) && <Link href="/mdt">MDT</Link>}
            {canUseDispatch(user?.role) && <Link href="/dispatch">Dispatch</Link>}
            {canUseAdmin(user?.role) && <Link href="/admin">Admin</Link>}
            <button
              onClick={async () => {
                await logout();
                window.location.href = "/";
              }}
            >
              Sign out
            </button>
          </div>
        </header>

        <nav className="gov-app-dock">
          {govApps.map((app) => (
            <button key={app} className={activeApp === app ? "active" : ""} onClick={() => setActiveApp(app)}>
              <span>{app.split(" ").map((part) => part[0]).join("")}</span>
              {app}
            </button>
          ))}
        </nav>

        {notice && <div className="toast-card success-strip">{notice}</div>}
        {formError && <div className="toast-card error-strip">{formError}</div>}

        <section className="government-window">
          <div className="window-chrome">
            <div className="window-lights">
              <span />
              <span />
              <span />
            </div>
            <strong>{activeApp}</strong>
            <small>Roleplay-only fictional government records</small>
          </div>
          <div className="window-body">
            {activeApp === "Identity Search" ? (
              <IdentitySearch search={search} results={searchResults} />
            ) : activeApp === "My Desk" ? (
              <MyDesk user={user} applications={applications} />
            ) : (
              <ApplicationQueue applications={filtered} reasons={reasons} setReasons={setReasons} decide={decide} />
            )}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function ApplicationQueue({
  applications,
  reasons,
  setReasons,
  decide
}: {
  applications: any[];
  reasons: Record<string, string>;
  setReasons: (value: Record<string, string>) => void;
  decide: (id: string, decision: "approved" | "denied") => void;
}) {
  if (!applications.length) {
    return <EmptyGov title="Queue Clear" body="No applications match this window." />;
  }

  return (
    <div className="gov-queue">
      {applications.map((application) => {
        const payload = application.payload || {};
        return (
          <article className="gov-case-file" key={application.id}>
            <div className="card-heading">
              <div>
                <p className="eyebrow">{application.type.replaceAll("_", " ")}</p>
                <h3>{application.user?.name}</h3>
                <p>{application.user?.email}</p>
              </div>
              <span className={`status-pill ${application.status}`}>{application.status}</span>
            </div>
            <div className="case-grid">
              {Object.entries(payload)
                .filter(([, value]) => value !== null && value !== "")
                .slice(0, 12)
                .map(([key, value]) => (
                  <div key={key}>
                    <span>{key}</span>
                    <strong>{String(value)}</strong>
                  </div>
                ))}
            </div>
            {application.status === "pending" && (
              <div className="decision-pop">
                <input
                  value={reasons[application.id] || ""}
                  onChange={(event) => setReasons({ ...reasons, [application.id]: event.target.value })}
                  placeholder="Decision note / denial reason"
                />
                <button className="button primary" onClick={() => decide(application.id, "approved")}>Approve</button>
                <button className="button danger" onClick={() => decide(application.id, "denied")}>Deny</button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function IdentitySearch({ search, results }: { search: (event: FormEvent<HTMLFormElement>) => void; results: any }) {
  return (
    <div className="search-panel">
      <form className="chat-compose" onSubmit={search}>
        <input name="q" placeholder="Search name, email, passport, plate, VIN, license, permit..." />
        <button className="button primary">Search</button>
      </form>
      {!results ? (
        <EmptyGov title="Records Search" body="Search fictional civilian, license, permit, and vehicle records." />
      ) : (
        <div className="record-rail gov-record-rail">
          {["people", "vehicles", "licenses", "permits"].flatMap((key) =>
            (results[key] || []).map((record: any) => (
              <article key={`${key}-${record.id}`}>
                <strong>{key.toUpperCase()} / {record.name || record.plate || record.number || record.id}</strong>
                <pre>{JSON.stringify(record, null, 2)}</pre>
              </article>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function MyDesk({ user, applications }: { user: any; applications: any[] }) {
  return (
    <div className="job-console">
      <h3>Employee Desk</h3>
      <p className="muted">Government staff can process DMV/passport/vehicle/business/firearm records without site-admin access.</p>
      <div className="info-card-grid">
        <div className="info-card">
          <span>Employee</span>
          <strong>{user?.name}</strong>
        </div>
        <div className="info-card">
          <span>Role</span>
          <strong>{roleLabel(user?.role)}</strong>
        </div>
        <div className="info-card">
          <span>Pending queue</span>
          <strong>{applications.filter((application) => application.status === "pending").length}</strong>
        </div>
      </div>
    </div>
  );
}

function EmptyGov({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-agency">
      <span>GOV</span>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}
