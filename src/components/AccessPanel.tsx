"use client";

import Link from "next/link";
import { logout } from "@/lib/api-client";

export function AccessPanel({
  title,
  message,
  loading,
  error
}: {
  title: string;
  message: string;
  loading?: boolean;
  error?: string | null;
}) {
  if (loading) {
    return (
      <main className="center-screen">
        <div className="glass-panel">Authenticating FairCroft CoreOne session…</div>
      </main>
    );
  }

  return (
    <main className="center-screen">
      <div className="glass-panel access-panel">
        <p className="eyebrow">Access Control</p>
        <h1>{title}</h1>
        <p>{error || message}</p>
        <div className="button-row">
          <Link href="/" className="button primary">
            Go to Login
          </Link>
          <button
            className="button ghost"
            onClick={() => {
              logout();
              window.location.href = "/";
            }}
          >
            Clear Session
          </button>
        </div>
      </div>
    </main>
  );
}
