const TRUE_VALUES = new Set(["1", "true", "yes", "y", "on"]);

export type EnvReadResult = {
  key: string | null;
  value: string;
  configured: boolean;
};

export type OwnerBootstrapConfig = {
  email: string;
  password: string;
  name: string;
  emailSource: string;
  passwordSource: string;
  nameSource: string;
  passwordConfigured: boolean;
  passwordDefaultUsed: boolean;
};

export function normalizeEnvValue(value: string | undefined | null) {
  if (typeof value !== "string") return "";

  let normalized = value.replace(/^\uFEFF/, "").trim();
  const first = normalized[0];
  const last = normalized[normalized.length - 1];

  if (normalized.length >= 2 && (first === "\"" || first === "'") && first === last) {
    normalized = normalized.slice(1, -1).trim();
  }

  return normalized;
}

export function readEnvValue(keys: string[], fallback = ""): EnvReadResult {
  for (const key of keys) {
    const value = normalizeEnvValue(process.env[key]);
    if (value) {
      return { key, value, configured: true };
    }
  }

  return {
    key: null,
    value: fallback,
    configured: false
  };
}

export function readBooleanEnv(keys: string[], fallback = false) {
  const env = readEnvValue(keys);
  if (!env.configured) return fallback;
  return TRUE_VALUES.has(env.value.toLowerCase());
}

export function getNodeEnv() {
  return readEnvValue(["NODE_ENV"], "development").value.toLowerCase();
}

export function isProductionEnv() {
  return getNodeEnv() === "production";
}

export function maskEmail(email: string | undefined | null) {
  const cleaned = normalizeEnvValue(email);
  if (!cleaned || !cleaned.includes("@")) return cleaned ? "***" : "";

  const [local, domain] = cleaned.split("@");
  const visible = local.slice(0, 1) || "*";
  return `${visible}***@${domain}`;
}

export function getOwnerBootstrapConfig(): OwnerBootstrapConfig {
  const email = readEnvValue(["OWNER_EMAIL", "COREONE_OWNER_EMAIL", "FAIRCROFT_OWNER_EMAIL"], "owner@faircroft.local");
  const passwordFallback = isProductionEnv() ? "" : "ChangeMe123!";
  const password = readEnvValue(
    ["OWNER_PASSWORD", "OWNER_PASS", "COREONE_OWNER_PASSWORD", "FAIRCROFT_OWNER_PASSWORD"],
    passwordFallback
  );
  const name = readEnvValue(["OWNER_NAME", "COREONE_OWNER_NAME", "FAIRCROFT_OWNER_NAME"], "FairCroft Owner");

  return {
    email: email.value.toLowerCase(),
    password: password.value,
    name: name.value || "FairCroft Owner",
    emailSource: email.key || "default",
    passwordSource: password.key || (passwordFallback ? "development_default" : "missing"),
    nameSource: name.key || "default",
    passwordConfigured: password.configured,
    passwordDefaultUsed: !password.configured && Boolean(passwordFallback)
  };
}
