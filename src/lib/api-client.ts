export type ApiError = Error & { status?: number; issues?: unknown };
export type ApiFetchInit = Omit<RequestInit, "body"> & { body?: unknown };

export function getToken() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("faircroft_token");
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (token) window.localStorage.setItem("faircroft_token", token);
    else window.localStorage.removeItem("faircroft_token");
  } catch {
    // Some iPhone/Safari standalone sessions can block storage. Keep the website visible.
  }
}

export async function apiFetch<T>(path: string, init: ApiFetchInit = {}) {
  const token = getToken();
  const headers = new Headers(init.headers);

  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(path, {
    ...init,
    headers,
    body: init.body && typeof init.body !== "string" ? JSON.stringify(init.body) : (init.body as BodyInit | undefined)
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const error = new Error(typeof payload === "object" && payload?.error ? payload.error : "Request failed.") as ApiError;
    error.status = response.status;
    error.issues = typeof payload === "object" ? payload?.issues : undefined;
    throw error;
  }

  return payload as T;
}

export async function login(email: string, password: string) {
  const payload = await apiFetch<{ token: string; user: any }>("/api/auth/login", {
    method: "POST",
    body: { email, password }
  });
  setToken(payload.token);
  return payload;
}

export async function logout() {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } finally {
    setToken(null);
  }
}
