"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AccessPanel } from "./AccessPanel";
import { FairCroftSeal } from "./FairCroftSeal";
import { Footer } from "./Footer";
import { apiFetch, logout } from "@/lib/api-client";
import { canUseAdmin, canUseDispatch, canUseMdt, roleLabel } from "@/lib/roles";
import { useAuth } from "./useAuth";

const apps = [
  ["Profile", "👤"],
  ["Driver License", "🪪"],
  ["Vehicle Registration", "🚗"],
  ["Firearm Permit", "◈"],
  ["Business License", "🏢"],
  ["Warrants", "⚖"],
  ["Tickets/Citations", "🧾"],
  ["911 Call", "☎"],
  ["Emergency Contacts", "🧰"],
  ["Civilian Records", "📁"],
  ["Court Notices", "🏛"],
  ["Department Applications", "⭐"]
] as const;

export function CivilianPortal() {
  const { user, loading, error, allowed, refresh } = useAuth("civilian");
  const [booting, setBooting] = useState(true);
  const [activeApp, setActiveApp] = useState<(typeof apps)[number][0]>("Profile");
  const [overview, setOverview] = useState<any>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setBooting(false), 1800);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void load();
  }, [allowed]);

  async function load() {
    const [overviewPayload, departmentPayload] = await Promise.all([
      apiFetch<any>("/api/civilian/overview"),
      apiFetch<{ departments: any[] }>("/api/departments")
    ]);
    setOverview(overviewPayload);
    setDepartments(departmentPayload.departments);
    await refresh();
  }

  async function submitApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setFormError(null);
    const form = new FormData(event.currentTarget);

    try {
      await apiFetch("/api/civilian/applications", {
        method: "POST",
        body: {
          departmentId: String(form.get("departmentId")),
          statement: String(form.get("statement")),
          experience: String(form.get("experience"))
        }
      });
      event.currentTarget.reset();
      setNotice("Application submitted to FairCroft administration.");
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unable to submit application.");
    }
  }

  async function submit911(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setFormError(null);
    const form = new FormData(event.currentTarget);

    try {
      await apiFetch("/api/civilian/911", {
        method: "POST",
        body: {
          emergencyType: String(form.get("emergencyType")),
          location: String(form.get("location")),
          description: String(form.get("description")),
          callerName: String(form.get("callerName")),
          callbackNumber: String(form.get("callbackNumber"))
        }
      });
      event.currentTarget.reset();
      setNotice("911 request transmitted to FairCroft Communications Dispatch.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unable to send 911 call.");
    }
  }

  const currentUser = overview?.user || user;
  const hasMdt = canUseMdt(currentUser?.role);
  const appPayload = useMemo(() => overview || {}, [overview]);

  if (!allowed) {
    return (
      <AccessPanel
        loading={loading}
        error={error}
        title="Civilian session required"
        message="Please sign in to access your FairCroft PDA."
      />
    );
  }

  if (booting || !overview) {
    return (
      <main className="pda-boot">
        <FairCroftSeal />
        <div className="boot-progress">
          <span />
        </div>
        <p>Booting FairCroft Government Services PDA…</p>
      </main>
    );
  }

  return (
    <>
      <main className="pda-shell">
        <section className="phone-frame">
          <div className="phone-status">
            <span>FairCroft LTE</span>
            <span>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
          <div className="phone-header">
            <FairCroftSeal compact />
            <div>
              <p className="eyebrow">Government Services</p>
              <h1>{currentUser?.profile?.firstName || currentUser?.name?.split(" ")[0]}'s PDA</h1>
              <p>{roleLabel(currentUser?.role)}</p>
            </div>
          </div>

          {hasMdt && (
            <div className="approved-banner">
              <strong>Department access approved.</strong>
              <span> MDT modules are unlocked for this account.</span>
              <div>
                <Link href="/mdt">Open MDT</Link>
                {canUseDispatch(currentUser?.role) && <Link href="/dispatch">Dispatch</Link>}
                {canUseAdmin(currentUser?.role) && <Link href="/admin">Admin</Link>}
              </div>
            </div>
          )}

          {!hasMdt && currentUser?.role === "pending_department" && (
            <div className="pending-banner">Department application pending. Civilian apps remain available only.</div>
          )}

          <div className="app-grid">
            {apps.map(([name, icon]) => (
              <button key={name} className={activeApp === name ? "app-icon active" : "app-icon"} onClick={() => setActiveApp(name)}>
                <span>{icon}</span>
                <small>{name}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="pda-app-panel">
          <div className="panel-title">
            <div>
              <p className="eyebrow">Civilian App</p>
              <h2>{activeApp}</h2>
            </div>
            <button
              className="button ghost"
              onClick={async () => {
                await logout();
                window.location.href = "/";
              }}
            >
              Sign out
            </button>
          </div>
          {notice && <div className="success-strip">{notice}</div>}
          {formError && <div className="error-strip">{formError}</div>}
          <CivilianAppContent
            activeApp={activeApp}
            overview={appPayload}
            departments={departments}
            submitApplication={submitApplication}
            submit911={submit911}
          />
        </section>
      </main>
      <Footer />
    </>
  );
}

function CivilianAppContent({
  activeApp,
  overview,
  departments,
  submitApplication,
  submit911
}: {
  activeApp: string;
  overview: any;
  departments: any[];
  submitApplication: (event: FormEvent<HTMLFormElement>) => void;
  submit911: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const profile = overview.user?.profile;

  if (activeApp === "Profile") {
    return (
      <div className="info-card-grid">
        <InfoCard label="Legal name" value={overview.user?.name} />
        <InfoCard label="Phone" value={overview.user?.phone || profile?.phone || "Not on file"} />
        <InfoCard label="Address" value={[profile?.address, profile?.city, profile?.state].filter(Boolean).join(", ") || "Not on file"} />
        <InfoCard label="Account role" value={roleLabel(overview.user?.role)} />
      </div>
    );
  }

  if (activeApp === "Driver License") {
    return <RecordList records={overview.licenses} empty="No driver license record has been issued." fields={["number", "class", "status", "expiresAt"]} />;
  }

  if (activeApp === "Vehicle Registration") {
    return <RecordList records={overview.vehicles} empty="No registered vehicles." fields={["plate", "year", "make", "model", "registrationStatus"]} />;
  }

  if (activeApp === "Firearm Permit") {
    return <RecordList records={overview.permits?.filter((permit: any) => permit.type.toLowerCase().includes("firearm"))} empty="No firearm permit record." fields={["number", "type", "status", "expiresAt"]} />;
  }

  if (activeApp === "Business License") {
    return <EmptyAgency title="Business Licensing" body="No business license records are attached to this roleplay civilian account." />;
  }

  if (activeApp === "Warrants") {
    return <RecordList records={overview.warrants} empty="No active warrant records associated with this civilian." fields={["subjectName", "charges", "status", "severity"]} />;
  }

  if (activeApp === "Tickets/Citations") {
    return <RecordList records={overview.citations} empty="No citations on file." fields={["subjectName", "statute", "description", "status"]} />;
  }

  if (activeApp === "911 Call") {
    return (
      <form className="stack-form agency-form" onSubmit={submit911}>
        <div className="warning-callout">
          This is a fictional roleplay 911 system. Do not use it for real emergencies.
        </div>
        <label>
          Emergency type
          <select name="emergencyType" required defaultValue="">
            <option value="" disabled>
              Select emergency type
            </option>
            <option>Police</option>
            <option>Fire</option>
            <option>EMS</option>
            <option>Traffic Collision</option>
            <option>Public Safety Hazard</option>
          </select>
        </label>
        <label>
          Location
          <input name="location" placeholder="Street, landmark, postal, or scene details" required />
        </label>
        <label>
          Description
          <textarea name="description" rows={5} placeholder="Describe what is happening now." required />
        </label>
        <div className="two-col">
          <label>
            Caller name
            <input name="callerName" defaultValue={overview.user?.name} required />
          </label>
          <label>
            Callback number
            <input name="callbackNumber" defaultValue={overview.user?.phone || profile?.phone || ""} required />
          </label>
        </div>
        <button className="button danger wide">Transmit 911 Call</button>
      </form>
    );
  }

  if (activeApp === "Emergency Contacts") {
    return <EmptyAgency title="Emergency Contacts" body="Add trusted roleplay contacts here in a future community-specific expansion." />;
  }

  if (activeApp === "Civilian Records") {
    return (
      <div className="records-stack">
        <InfoCard label="Civilian ID" value={overview.user?.id} />
        <InfoCard label="Record flags" value={profile?.recordFlags?.length ? profile.recordFlags.join(", ") : "None"} />
        <InfoCard label="Administrative notes" value={profile?.notes || "No notes"} />
      </div>
    );
  }

  if (activeApp === "Court Notices") {
    return <EmptyAgency title="Court Notices" body="No fictional FairCroft Municipal Court notices are pending." />;
  }

  if (activeApp === "Department Applications") {
    return (
      <div className="application-layout">
        <form className="stack-form agency-form" onSubmit={submitApplication}>
          <label>
            Department
            <select name="departmentId" required defaultValue="">
              <option value="" disabled>
                Select a FairCroft department
              </option>
              {departments.map((department) => (
                <option value={department.id} key={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Why do you want to join?
            <textarea name="statement" rows={5} required placeholder="Keep it immersive and roleplay focused." />
          </label>
          <label>
            Relevant roleplay experience
            <textarea name="experience" rows={4} placeholder="Optional" />
          </label>
          <button className="button primary wide">Submit Department Application</button>
        </form>
        <RecordList records={overview.applications} empty="No applications submitted yet." fields={["department.name", "status", "submittedAt", "decisionReason"]} />
      </div>
    );
  }

  return null;
}

function InfoCard({ label, value }: { label: string; value: any }) {
  return (
    <div className="info-card">
      <span>{label}</span>
      <strong>{String(value || "—")}</strong>
    </div>
  );
}

function valueAt(record: any, path: string) {
  return path.split(".").reduce((current, key) => current?.[key], record);
}

function RecordList({ records, empty, fields }: { records?: any[]; empty: string; fields: string[] }) {
  if (!records?.length) return <EmptyAgency title="No Records" body={empty} />;

  return (
    <div className="record-list">
      {records.map((record) => (
        <article className="record-card" key={record.id}>
          {fields.map((field) => (
            <div key={field}>
              <span>{field.split(".").at(-1)}</span>
              <strong>{formatValue(valueAt(record, field))}</strong>
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}

function formatValue(value: any) {
  if (!value) return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleDateString();
  return String(value);
}

function EmptyAgency({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-agency">
      <span>FC</span>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}
