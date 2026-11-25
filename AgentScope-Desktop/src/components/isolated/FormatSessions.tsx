import { useState } from 'react';
import { api } from '../../api';
import type { FormatSession } from '../../types';

export default function FormatSessions() {
  const [sessions, setSessions] = useState<FormatSession[]>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    setError('');
    try {
      setSessions(await api.formatSessions());
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <section aria-label="Phiên kiểm tra Skill báo cáo">
      <button className="secondary-button" disabled={loading} onClick={() => void load()}>
        Xem phiên Gemini kiểm tra quyền chạy script
      </button>
      {error && <p role="alert">{error}</p>}
      {sessions?.map((session) => (
        <details key={session.session}>
          <summary>
            {session.consent ? 'Cho phép canary' : 'Chỉ cho đọc tài nguyên'} · {session.session}
          </summary>
          <p>
            {session.model} · Đọc tài nguyên qua MCP · {session.reference_call ?? 'Chưa xác minh'}
          </p>
          <p>Quyền ACP cho đề xuất kiểm tra · {session.check_permission ?? 'Chưa ghi nhận'}</p>
          <p>
            PID canary do Backend chạy và xác minh · {session.verified_pid ?? 'Chưa ghi nhận'} ·
            Excel đạt kiểm tra · {session.valid_excel ? 'Có' : 'Không'}
          </p>
          <pre>{session.raw_answer || '(Lời đáp trống)'}</pre>
        </details>
      ))}
    </section>
  );
}
