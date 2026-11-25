import type { ExecutionEvent } from './types';

export const isSecurityEvidence = (event: ExecutionEvent) =>
  event.event_type.startsWith('security.') ||
  event.event_type === 'permission.evaluated' ||
  event.event_type === 'session.mode';

export function securityLabel(event: ExecutionEvent): string {
  if (event.event_type === 'security.unmediated_tool') return 'Không qua SkillGuard';
  if (event.event_type === 'security.authorization_violation') return 'Hoàn tất sau từ chối';
  if (event.event_type === 'security.execution_restricted') return 'Ngăn gửi Skill tới ACP';
  if (event.event_type === 'security.boundary') return 'Giới hạn bảo vệ';
  if (event.event_type === 'security.execution_mode_changed') return 'ACP thay đổi mode';
  if (event.event_type === 'session.mode')
    return `ACP: ${String(event.result.current_mode_id || 'chưa rõ')}`;
  if (event.permission_decision === 'allow') return 'Chính sách cho phép';
  if (event.permission_decision === 'deny') return 'Chính sách từ chối';
  return 'Chờ phê duyệt';
}
