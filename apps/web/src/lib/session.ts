import { can, effectiveProjectRole, type Action } from '@qah/validation';
import { useAppSelector } from '@/app/store';
import { useMeQuery } from '@/features/api';

/** Tổ chức đang chọn: lấy từ store, mặc định tổ chức đầu tiên của user */
export function useCurrentOrg() {
  const { data: me } = useMeQuery();
  const selected = useAppSelector((s) => s.session.orgId);
  return me?.organizations.find((o) => o.id === selected) ?? me?.organizations[0] ?? null;
}

/**
 * Quyền trên UI (docs/10 §7) đọc từ /auth/me, cùng ma trận với backend (@qah/validation).
 * Chỉ để ẩn/disable nút; backend vẫn kiểm mọi request.
 */
export function useCan(action: Action, projectId?: string): boolean {
  const org = useCurrentOrg();
  if (!org) return false;
  if (!projectId || !action.startsWith('project.')) return can(org.role, action);
  const pr = org.projects.find((p) => p.projectId === projectId)?.role;
  return can(effectiveProjectRole(org.role, pr), action);
}
