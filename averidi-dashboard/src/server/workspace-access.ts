import { dashboardDb } from "./db";

export type VerifiedDashboardActor = Readonly<{
  userId: string;
  issuer: string;
  subject: string;
}>;

// Callers must establish this identity using a verified session or OIDC token.
// Never accept an actor object or workspace membership from request JSON.
export async function resolveVerifiedDashboardActor(identity: {issuer: string; subject: string}): Promise<VerifiedDashboardActor | null> {
  if (!identity.issuer.trim() || !identity.subject.trim()) return null;
  const user = await dashboardDb.dashboardUser.findUnique({
    where: { externalSubject: identity.issuer + "|" + identity.subject,erasureRequestedAt:null },
    select: { id: true },
  });
  return user ? { userId: user.id, ...identity } : null;
}

export type DashboardWorkspaceRole = "OWNER" | "EDITOR" | "VIEWER";
const allowedRoles: Record<DashboardWorkspaceRole, readonly DashboardWorkspaceRole[]> = {
  OWNER: ["OWNER"],
  EDITOR: ["OWNER", "EDITOR"],
  VIEWER: ["OWNER", "EDITOR", "VIEWER"],
};

export function roleAllows(actual: string, required: DashboardWorkspaceRole): boolean {
  return allowedRoles[required].includes(actual as DashboardWorkspaceRole);
}

export async function requireWorkspaceRole(actor: VerifiedDashboardActor, workspaceId: string, required: DashboardWorkspaceRole) {
  if (!workspaceId || !actor.userId) return null;
  const membership = await dashboardDb.dashboardMembership.findUnique({
    where: { userId_workspaceId: { userId: actor.userId, workspaceId }, user:{erasureRequestedAt:null} },
    select: { id: true, role: true, workspaceId: true },
  });
  return membership && roleAllows(membership.role, required) ? membership : null;
}
