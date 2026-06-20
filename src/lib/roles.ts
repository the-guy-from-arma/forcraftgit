export const civilianOnlyRoles = new Set(["unverified_civ", "civilian", "pending_department"]);
export const departmentRoles = new Set([
  "police",
  "sheriff",
  "fire",
  "ems",
  "dispatcher",
  "department_supervisor",
  "site_admin",
  "owner"
]);
export const dispatcherRoles = new Set(["dispatcher", "site_admin", "owner"]);
export const governmentRoles = new Set(["government_employee", "dispatcher", "site_admin", "owner"]);
export const adminRoles = new Set(["site_admin", "owner"]);

export function canUseMdt(role?: string) {
  return !!role && departmentRoles.has(role);
}

export function canUseDispatch(role?: string) {
  return !!role && dispatcherRoles.has(role);
}

export function canUseGovernment(role?: string) {
  return !!role && governmentRoles.has(role);
}

export function canUseAdmin(role?: string) {
  return !!role && adminRoles.has(role);
}

export function roleLabel(role?: string) {
  if (!role) return "Unauthenticated";
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export const unitStatusLabels: Record<string, string> = {
  TEN_8_AVAILABLE: "10-8 Available",
  TEN_6_BUSY: "10-6 Busy",
  TEN_7_OUT_OF_SERVICE: "10-7 Out of Service",
  TEN_23_ON_SCENE: "10-23 On Scene",
  TEN_97_EN_ROUTE: "10-97 En Route",
  TEN_15_TRANSPORTING: "10-15 Transporting",
  CODE_4_CLEAR: "Code 4 Clear",
  PRIORITY_RESPONSE: "Priority Response"
};
