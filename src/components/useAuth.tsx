"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, getToken, setToken } from "@/lib/api-client";
import { canUseAdmin, canUseDispatch, canUseGovernment, canUseMdt } from "@/lib/roles";

type Requirement = "any" | "civilian" | "department" | "dispatch" | "government" | "admin";

export function useAuth(requirement: Requirement = "any") {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(() => Boolean(getToken()));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const payload = await apiFetch<{ user: any }>("/api/auth/me");
      setUser(payload.user);
      setError(null);
    } catch (err) {
      setToken(null);
      setUser(null);
      setError(err instanceof Error ? err.message : "Session expired.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const allowed =
    requirement === "any" ||
    (requirement === "civilian" && !!user) ||
    (requirement === "department" && canUseMdt(user?.role)) ||
    (requirement === "dispatch" && canUseDispatch(user?.role)) ||
    (requirement === "government" && canUseGovernment(user?.role)) ||
    (requirement === "admin" && canUseAdmin(user?.role));

  return { user, setUser, loading, error, allowed, refresh };
}
