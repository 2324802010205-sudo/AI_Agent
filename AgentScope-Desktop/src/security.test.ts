import { describe, expect, it } from 'vitest';
import type { ExecutionEvent } from './types';
import { isSecurityEvidence, securityLabel } from './security';

const event = (event_type: string, permission_decision?: string): ExecutionEvent => ({
  id: 'e',
  run_id: 'r',
  step_id: 's',
  timestamp: '',
  source: 'skillguard',
  event_type,
  permission_decision,
  result: {},
  arguments: {},
  message: 'evidence',
  status: 'completed',
  mode: 'real',
});

describe('security evidence', () => {
  it('keeps authorization, observed bypass and delivery prevention distinct', () => {
    expect(securityLabel(event('permission.evaluated', 'allow'))).toBe('Chính sách cho phép');
    expect(securityLabel(event('permission.evaluated', 'deny'))).toBe('Chính sách từ chối');
    expect(securityLabel(event('security.unmediated_tool'))).toBe('Không qua SkillGuard');
    expect(securityLabel(event('security.authorization_violation'))).toBe('Hoàn tất sau từ chối');
    expect(securityLabel(event('security.execution_restricted'))).toBe('Ngăn gửi Skill tới ACP');
  });
  it('includes boundary warnings and modes without calling tool observations approvals', () => {
    expect(isSecurityEvidence(event('security.boundary'))).toBe(true);
    expect(isSecurityEvidence(event('session.mode'))).toBe(true);
    expect(securityLabel(event('session.mode'))).toBe('ACP: chưa rõ');
    expect(isSecurityEvidence(event('tool.completed'))).toBe(false);
  });
});
