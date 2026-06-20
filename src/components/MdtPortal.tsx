"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { AccessPanel } from "./AccessPanel";
import { Footer } from "./Footer";
import { apiFetch, getToken, logout } from "@/lib/api-client";
import { canUseAdmin, canUseDispatch, roleLabel, unitStatusLabels } from "@/lib/roles";
import { useAuth } from "./useAuth";

const modules = [
  "Dashboard",
  "Active Calls",
  "Create Call",
  "Assign Units",
  "Unit Status",
  "BOLOs",
  "Warrants",
  "People Search",
  "Vehicle Search",
  "Plate Search",
  "Citation Writer",
  "Incident Reports",
  "Arrest Reports",
  "Fire Reports",
  "EMS Patient Care Reports",
  "Dispatch Chat",
  "Radio Log",
  "Call History",
  "Shift Clock",
  "Department Roster"
] as const;

export function MdtPortal() {
  const { user, loading, error, allowed } = useAuth("department");
  const [activeModule, setActiveModule] = useState<(typeof modules)[number]>("Dashboard");
  const [dashboard, setDashboard] = useState<any>(null);
  const [records, setRecords] = useState<any>(null);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [chatBody, setChatBody] = useState("");
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!allowed) return;
    void loadDashboard();
    void loadRecords();

    const socket = io({ auth: { token: getToken() } });
    socketRef.current = socket;
    socket.on("cad:call-created", (call) => {
      setDashboard((current: any) => current && { ...current, calls: [call, ...(current.calls || [])] });
      setNotice(`New CAD call: ${call.callNumber}`);
    });
    socket.on("cad:unit-assigned", (assignment) => {
      setNotice(`Unit ${assignment.cadUnit?.unitNumber} assigned to ${assignment.cadCall?.callNumber}`);
      void loadDashboard();
    });
    socket.on("notification", (notification) => setNotice(notification.body || notification.title));
    socket.on("unit:status", () => void loadDashboard());
    socket.on("dispatch:message", (message) => {
      setDashboard((current: any) => current && { ...current, messages: [...(current.messages || []), message].slice(-60) });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [allowed]);

  async function loadDashboard() {
    const payload = await apiFetch<any>("/api/cad/dashboard");
    setDashboard(payload);
  }

  async function loadRecords() {
    const payload = await apiFetch<any>("/api/cad/records");
    setRecords(payload);
  }

  async function submitCreateCall(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitForm(event, "/api/cad/calls", "CAD call created.");
    await loadDashboard();
  }

  async function submitAssign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submitForm(event, `/api/cad/calls/${String(form.get("cadCallId"))}/assign`, "Unit assignment transmitted.", {
      unitId: String(form.get("unitId"))
    });
    await loadDashboard();
  }

  async function submitUnitStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submitForm(event, `/api/cad/units/${String(form.get("unitId"))}/status`, "Unit status updated.", {
      status: String(form.get("status"))
    }, "PATCH");
    await loadDashboard();
  }

  async function submitBolo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitForm(event, "/api/cad/bolos", "BOLO published.");
    await loadRecords();
  }

  async function submitWarrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitForm(event, "/api/cad/warrants", "Warrant record created.");
    await loadRecords();
  }

  async function submitCitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitForm(event, "/api/cad/citations", "Citation written.");
    await loadRecords();
  }

  async function submitReport(event: FormEvent<HTMLFormElement>, type: string) {
    event.preventDefault();
    await submitForm(event, `/api/cad/reports/${type}`, `${type.toUpperCase()} report submitted.`);
    await loadRecords();
  }

  async function submitForm(
    event: FormEvent<HTMLFormElement>,
    path: string,
    success: string,
    override?: Record<string, string>,
    method = "POST"
  ) {
    setNotice(null);
    setFormError(null);
    const form = new FormData(event.currentTarget);
    const body = override || Object.fromEntries(form.entries());

    try {
      await apiFetch(path, { method, body });
      event.currentTarget.reset();
      setNotice(success);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Operation failed.");
    }
  }

  async function search(kind: "people" | "vehicles", query: string) {
    setSearchResults([]);
    if (!query.trim()) return;
    const payload = await apiFetch<any>(`/api/cad/search/${kind}?q=${encodeURIComponent(query)}`);
    setSearchResults(payload.people || payload.vehicles || []);
  }

  function sendChat() {
    const body = chatBody.trim();
    if (!body) return;
    socketRef.current?.emit("dispatch:message", { body, channel: "dispatch" });
    setChatBody("");
  }

  const activeCalls = dashboard?.calls || [];
  const units = dashboard?.units || [];
  const memberships = user?.memberships || [];

  const roster = useMemo(() => {
    return memberships.flatMap((membership: any) =>
      membership.department?.memberships?.length ? membership.department.memberships : [membership]
    );
  }, [memberships]);

  if (!allowed) {
    return <AccessPanel loading={loading} error={error} title="Department MDT locked" message="An approved department role is required." />;
  }

  if (!dashboard) {
    return (
      <main className="mdt-shell center-screen">
        <div className="terminal-card">Establishing CoreOne MDT data link…</div>
      </main>
    );
  }

  return (
    <>
      <main className="mdt-shell">
        <aside className="mdt-sidebar">
          <div className="mdt-brand">
            <span>FC</span>
            <div>
              <strong>CoreOne MDT</strong>
              <small>{roleLabel(user?.role)}</small>
            </div>
          </div>
          <nav>
            {modules.map((module) => (
              <button key={module} className={activeModule === module ? "active" : ""} onClick={() => setActiveModule(module)}>
                {module}
              </button>
            ))}
          </nav>
          <div className="mdt-sidebar-footer">
            <Link href="/civilian">Civilian PDA</Link>
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
        </aside>

        <section className="mdt-workspace">
          <header className="mdt-topbar">
            <div>
              <p className="eyebrow">FairCroft Department Terminal</p>
              <h1>{activeModule}</h1>
            </div>
            <div className="terminal-status">
              <span className="live-dot" />
              LIVE CAD LINK
            </div>
          </header>
          {notice && <div className="success-strip terminal-strip">{notice}</div>}
          {formError && <div className="error-strip terminal-strip">{formError}</div>}
          <MdtModule
            activeModule={activeModule}
            dashboard={dashboard}
            records={records}
            activeCalls={activeCalls}
            units={units}
            roster={roster}
            searchResults={searchResults}
            canDispatch={canUseDispatch(user?.role)}
            chatBody={chatBody}
            setChatBody={setChatBody}
            sendChat={sendChat}
            search={search}
            submitCreateCall={submitCreateCall}
            submitAssign={submitAssign}
            submitUnitStatus={submitUnitStatus}
            submitBolo={submitBolo}
            submitWarrant={submitWarrant}
            submitCitation={submitCitation}
            submitReport={submitReport}
          />
        </section>
      </main>
      <Footer />
    </>
  );
}

function MdtModule(props: any) {
  const {
    activeModule,
    dashboard,
    records,
    activeCalls,
    units,
    roster,
    searchResults,
    canDispatch,
    chatBody,
    setChatBody,
    sendChat,
    search,
    submitCreateCall,
    submitAssign,
    submitUnitStatus,
    submitBolo,
    submitWarrant,
    submitCitation,
    submitReport
  } = props;

  if (activeModule === "Dashboard") {
    return (
      <div className="mdt-grid">
        <Metric label="Active Calls" value={activeCalls.length} />
        <Metric label="Available Units" value={units.filter((unit: any) => unit.status === "TEN_8_AVAILABLE").length} />
        <Metric label="Active BOLOs" value={dashboard.bolos?.length || 0} />
        <Metric label="Warrants" value={dashboard.warrants?.length || 0} />
        <CallBoard calls={activeCalls} />
        <UnitBoard units={units} />
      </div>
    );
  }

  if (activeModule === "Active Calls" || activeModule === "Call History") {
    return <CallBoard calls={activeCalls} full />;
  }

  if (activeModule === "Create Call") {
    return (
      <TerminalForm onSubmit={submitCreateCall}>
        <label>
          Call type
          <input name="type" placeholder="Traffic Stop, Structure Fire, Medical Aid…" required />
        </label>
        <label>
          Location
          <input name="location" required />
        </label>
        <label>
          Priority
          <select name="priority" defaultValue="routine">
            <option value="low">Low</option>
            <option value="routine">Routine</option>
            <option value="priority">Priority</option>
            <option value="emergency">Emergency</option>
          </select>
        </label>
        <label>
          Description
          <textarea name="description" rows={5} required />
        </label>
        <button className="button terminal">Create CAD Call</button>
      </TerminalForm>
    );
  }

  if (activeModule === "Assign Units") {
    return canDispatch ? (
      <TerminalForm onSubmit={submitAssign}>
        <label>
          CAD call
          <select name="cadCallId" required defaultValue="">
            <option value="" disabled>
              Select call
            </option>
            {activeCalls.map((call: any) => (
              <option key={call.id} value={call.id}>
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
            {units.map((unit: any) => (
              <option key={unit.id} value={unit.id}>
                {unit.unitNumber} — {unitStatusLabels[unit.status]}
              </option>
            ))}
          </select>
        </label>
        <button className="button terminal">Assign Unit</button>
      </TerminalForm>
    ) : (
      <TerminalEmpty title="Dispatcher function" body="Only dispatchers, site admins, and owners can assign units." />
    );
  }

  if (activeModule === "Unit Status") return <UnitStatusForm units={units} onSubmit={submitUnitStatus} />;
  if (activeModule === "BOLOs") return <RecordsAndForm records={records?.bolos} onSubmit={submitBolo} kind="bolo" />;
  if (activeModule === "Warrants") return <RecordsAndForm records={records?.warrants} onSubmit={submitWarrant} kind="warrant" />;
  if (activeModule === "Citation Writer") return <CitationForm onSubmit={submitCitation} records={records?.citations} />;
  if (activeModule === "Incident Reports") return <ReportForm type="incident" onSubmit={submitReport} records={records?.incidentReports} />;
  if (activeModule === "Arrest Reports") return <ReportForm type="arrest" onSubmit={submitReport} records={records?.arrestReports} />;
  if (activeModule === "Fire Reports") return <ReportForm type="fire" onSubmit={submitReport} records={records?.fireReports} />;
  if (activeModule === "EMS Patient Care Reports") return <ReportForm type="ems" onSubmit={submitReport} records={records?.emsReports} />;

  if (activeModule === "People Search" || activeModule === "Vehicle Search" || activeModule === "Plate Search") {
    const vehicle = activeModule !== "People Search";
    return (
      <SearchPanel
        placeholder={vehicle ? "Plate, VIN, make, model…" : "Name, email, identifier…"}
        onSearch={(query) => search(vehicle ? "vehicles" : "people", query)}
        results={searchResults}
      />
    );
  }

  if (activeModule === "Dispatch Chat" || activeModule === "Radio Log") {
    return (
      <div className="chat-panel">
        <div className="chat-log">
          {(dashboard.messages || []).map((message: any) => (
            <div key={message.id} className="chat-line">
              <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
              <strong>{message.user?.name || "Unit"}</strong>
              <p>{message.body}</p>
            </div>
          ))}
        </div>
        <div className="chat-compose">
          <input value={chatBody} onChange={(event) => setChatBody(event.target.value)} placeholder="Transmit dispatch message…" />
          <button className="button terminal" onClick={sendChat}>
            TX
          </button>
        </div>
      </div>
    );
  }

  if (activeModule === "Shift Clock") return <ShiftClock />;
  if (activeModule === "Department Roster") return <Roster roster={roster} units={units} />;

  return <TerminalEmpty title={activeModule} body="Module reserved for future FairCroft community expansion." />;
}

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CallBoard({ calls, full = false }: { calls: any[]; full?: boolean }) {
  if (!calls.length) return <TerminalEmpty title="No active calls" body="CAD board is currently clear." />;
  return (
    <div className={full ? "terminal-table full-span" : "terminal-table"}>
      <h3>CAD Calls</h3>
      {calls.map((call) => (
        <article key={call.id}>
          <div>
            <strong>{call.callNumber}</strong>
            <span>{call.priority}</span>
          </div>
          <p>{call.type}</p>
          <small>{call.location}</small>
          <small>{call.assignments?.map((assignment: any) => assignment.cadUnit?.unitNumber).join(", ") || "Unassigned"}</small>
        </article>
      ))}
    </div>
  );
}

function UnitBoard({ units }: { units: any[] }) {
  return (
    <div className="terminal-table">
      <h3>Units</h3>
      {units.map((unit) => (
        <article key={unit.id}>
          <div>
            <strong>{unit.unitNumber}</strong>
            <span>{unit.department?.code}</span>
          </div>
          <p>{unitStatusLabels[unit.status]}</p>
          <small>{unit.user?.name || "Unstaffed"}</small>
        </article>
      ))}
    </div>
  );
}

function TerminalForm({ onSubmit, children }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; children: React.ReactNode }) {
  return (
    <form className="terminal-form" onSubmit={onSubmit}>
      {children}
    </form>
  );
}

function UnitStatusForm({ units, onSubmit }: { units: any[]; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <TerminalForm onSubmit={onSubmit}>
      <label>
        Unit
        <select name="unitId" required defaultValue="">
          <option value="" disabled>
            Select unit
          </option>
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.unitNumber}
            </option>
          ))}
        </select>
      </label>
      <label>
        Status
        <select name="status" required defaultValue="TEN_8_AVAILABLE">
          {Object.entries(unitStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button className="button terminal">Update Status</button>
      <UnitBoard units={units} />
    </TerminalForm>
  );
}

function RecordsAndForm({ records, onSubmit, kind }: { records?: any[]; onSubmit: (event: FormEvent<HTMLFormElement>) => void; kind: string }) {
  return (
    <div className="split-terminal">
      <TerminalForm onSubmit={onSubmit}>
        {kind === "bolo" ? (
          <>
            <label>
              BOLO title
              <input name="title" required />
            </label>
            <label>
              Description
              <textarea name="description" rows={5} required />
            </label>
            <label>
              Plate
              <input name="plate" />
            </label>
            <label>
              Person name
              <input name="personName" />
            </label>
            <label>
              Vehicle description
              <input name="vehicleDescription" />
            </label>
            <button className="button terminal">Publish BOLO</button>
          </>
        ) : (
          <>
            <label>
              Subject name
              <input name="subjectName" required />
            </label>
            <label>
              Charges
              <textarea name="charges" rows={5} required />
            </label>
            <label>
              Severity
              <select name="severity" defaultValue="routine">
                <option value="routine">Routine</option>
                <option value="priority">Priority</option>
                <option value="emergency">Emergency</option>
              </select>
            </label>
            <button className="button terminal">Create Warrant</button>
          </>
        )}
      </TerminalForm>
      <RecordRail records={records} />
    </div>
  );
}

function CitationForm({ onSubmit, records }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; records?: any[] }) {
  return (
    <div className="split-terminal">
      <TerminalForm onSubmit={onSubmit}>
        <label>
          Subject name
          <input name="subjectName" required />
        </label>
        <label>
          Statute / Ordinance
          <input name="statute" required placeholder="FC-MC 12.04" />
        </label>
        <label>
          Description
          <textarea name="description" rows={5} required />
        </label>
        <label>
          Fine in cents
          <input name="fineCents" type="number" min="0" defaultValue="0" />
        </label>
        <label>
          Location
          <input name="location" />
        </label>
        <button className="button terminal">Issue Citation</button>
      </TerminalForm>
      <RecordRail records={records} />
    </div>
  );
}

function ReportForm({
  type,
  onSubmit,
  records
}: {
  type: string;
  onSubmit: (event: FormEvent<HTMLFormElement>, type: string) => void;
  records?: any[];
}) {
  return (
    <div className="split-terminal">
      <TerminalForm onSubmit={(event) => onSubmit(event, type)}>
        <label>
          Report title / incident type
          <input name={type === "fire" ? "incidentType" : "title"} placeholder={`${type} report`} />
        </label>
        {(type === "arrest" || type === "ems") && (
          <label>
            Subject / patient name
            <input name={type === "ems" ? "patientName" : "subjectName"} />
          </label>
        )}
        {type === "arrest" && (
          <label>
            Charges
            <textarea name="charges" rows={3} />
          </label>
        )}
        {type === "ems" && (
          <>
            <label>
              Patient age
              <input name="patientAge" type="number" min="0" />
            </label>
            <label>
              Chief complaint
              <input name="chiefComplaint" />
            </label>
            <label>
              Care provided
              <textarea name="careProvided" rows={3} />
            </label>
            <label>
              Disposition
              <input name="disposition" />
            </label>
          </>
        )}
        {type === "fire" && (
          <>
            <label>
              Cause
              <input name="cause" />
            </label>
            <label>
              Actions taken
              <textarea name="actions" rows={3} />
            </label>
          </>
        )}
        <label>
          Narrative
          <textarea name="narrative" rows={7} required />
        </label>
        {type === "ems" && <p className="terminal-note">EMS PCR is for roleplay only and has no medical validity.</p>}
        <button className="button terminal">Submit {type.toUpperCase()} Report</button>
      </TerminalForm>
      <RecordRail records={records} />
    </div>
  );
}

function SearchPanel({ placeholder, onSearch, results }: { placeholder: string; onSearch: (query: string) => void; results: any[] }) {
  const [query, setQuery] = useState("");
  return (
    <div className="search-panel">
      <div className="chat-compose">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} />
        <button className="button terminal" onClick={() => onSearch(query)}>
          Search
        </button>
      </div>
      <RecordRail records={results} />
    </div>
  );
}

function RecordRail({ records }: { records?: any[] }) {
  if (!records?.length) return <TerminalEmpty title="No records" body="No matching fictional records are currently on file." />;
  return (
    <div className="record-rail">
      {records.map((record) => (
        <article key={record.id}>
          <strong>{record.callNumber || record.title || record.subjectName || record.name || record.plate || record.reportNumber || record.id}</strong>
          <pre>{JSON.stringify(record, null, 2)}</pre>
        </article>
      ))}
    </div>
  );
}

function ShiftClock() {
  const [started] = useState(new Date());
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsed = Math.floor((now.getTime() - started.getTime()) / 1000);
  const h = String(Math.floor(elapsed / 3600)).padStart(2, "0");
  const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
  const s = String(elapsed % 60).padStart(2, "0");
  return (
    <div className="shift-clock">
      <span>SHIFT CLOCK</span>
      <strong>
        {h}:{m}:{s}
      </strong>
      <p>Started {started.toLocaleString()}</p>
    </div>
  );
}

function Roster({ roster, units }: { roster: any[]; units: any[] }) {
  return (
    <div className="terminal-table full-span">
      <h3>Department Roster</h3>
      {roster.map((membership: any) => (
        <article key={membership.id}>
          <div>
            <strong>{membership.user?.name || "Current User"}</strong>
            <span>{membership.department?.code}</span>
          </div>
          <p>{membership.rank?.name || roleLabel(membership.role)}</p>
          <small>{units.find((unit) => unit.userId === membership.userId)?.unitNumber || "No active unit"}</small>
        </article>
      ))}
    </div>
  );
}

function TerminalEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="terminal-empty">
      <span>▣</span>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}
