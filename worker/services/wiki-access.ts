import type { AuthUser } from '../types';

type WikiUser = Pick<AuthUser, 'roles' | 'permissions'>;

export function isWorkspaceAdmin(user: WikiUser): boolean {
  return user.permissions.includes('workspace.admin') || user.roles.includes('super_admin');
}

export function isSupervisor(user: WikiUser): boolean {
  return !isWorkspaceAdmin(user) && user.roles.includes('project_supervisor');
}

export function canViewWiki(user: WikiUser, visibility: string): boolean {
  if (isWorkspaceAdmin(user)) return true;
  if (visibility === 'members') return true;
  if (visibility === 'supervisor') return isSupervisor(user);
  return false;
}

export function canEditWiki(user: WikiUser, visibility: string): boolean {
  if (isWorkspaceAdmin(user)) return true;
  if (isSupervisor(user)) return false;
  return visibility === 'members';
}

export function canCreateWiki(user: WikiUser, visibility: string): boolean {
  if (isWorkspaceAdmin(user)) return true;
  if (isSupervisor(user)) return false;
  return visibility === 'members';
}

/** SQL predicate for listing wiki pages. Empty SQL means no restriction (admin). */
export function wikiVisibilityFilter(user: WikiUser): { sql: string; binds: string[] } {
  if (isWorkspaceAdmin(user)) return { sql: '', binds: [] };
  if (isSupervisor(user)) return { sql: `p.visibility IN ('members','supervisor')`, binds: [] };
  return { sql: `p.visibility = 'members'`, binds: [] };
}
