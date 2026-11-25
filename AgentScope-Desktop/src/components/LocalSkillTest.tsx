import { useState } from 'react';
import { api } from '../api';
import type { LocalSkillTestResult } from '../types';
import { assessmentLabel } from './SkillEvidence';

export default function LocalSkillTest({ skillId }: { skillId: string }) {
  const [task, setTask] = useState('');
  const [spreadsheet, setSpreadsheet] = useState(false);
  const [result, setResult] = useState<LocalSkillTestResult>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setResult(undefined);
    setError('');
    setBusy(true);
    try {
      setResult(await api.testSkillLocally(skillId, task, spreadsheet));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="lab-plan" aria-label="Kiểm tra Skill cục bộ">
      <h4>Kiểm tra Skill cục bộ</h4>
      <p>
        Đọc và quét lại chính bản cài đặt để kiểm tra toàn vẹn, độ phù hợp và trạng thái runtime.
        Phép kiểm tra chỉ đọc, không cần AppContainer, đăng nhập ACP hoặc chạy mã trong gói.
      </p>
      <form
        className="lab-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <label>
          Tác vụ thử
          <input
            value={task}
            maxLength={1000}
            disabled={busy}
            placeholder="Có thể để trống để thử bằng tên Skill"
            onChange={(event) => {
              setResult(undefined);
              setTask(event.target.value);
            }}
          />
        </label>
        <label>
          Loại tác vụ
          <select
            value={spreadsheet ? 'spreadsheet' : 'text'}
            disabled={busy}
            onChange={(event) => {
              setResult(undefined);
              setSpreadsheet(event.target.value === 'spreadsheet');
            }}
          >
            <option value="text">Văn bản</option>
            <option value="spreadsheet">Bảng tính</option>
          </select>
        </label>
        <div>
          <button className="secondary-button" disabled={busy} type="submit">
            {busy ? 'Đang kiểm tra…' : 'Chạy kiểm tra cục bộ'}
          </button>
        </div>
      </form>
      {error && <p role="alert">{error}</p>}
      {result && (
        <div role="status" data-testid="local-skill-test-result">
          <ul>
            <li>
              Toàn vẹn SHA-256 đã xác minh ·{' '}
              <code title={result.package_sha256}>{result.package_sha256.slice(0, 16)}…</code>
            </li>
            <li>
              Quét lại · {assessmentLabel[result.security.assessment]} ·{' '}
              {result.security.findings.length} mục ghi nhận
            </li>
            <li>{result.matches_task ? 'Phù hợp tác vụ thử' : 'Chưa phù hợp tác vụ thử'}</li>
            <li>
              {result.available
                ? 'Bản cài đặt đủ điều kiện để runtime chọn'
                : result.installation_status === 'disabled'
                  ? 'Bản cài đặt đang tắt'
                  : 'Bản cài đặt bị chặn khỏi lựa chọn trong chế độ thường'}
            </li>
          </ul>
          {result.requested_tools.length > 0 && (
            <details>
              <summary>Công cụ được khai trong metadata</summary>
              <ul>
                {result.requested_tools.map(({ name, registered }) => (
                  <li key={name}>
                    <code>{name}</code> · {registered ? 'Có trong registry' : 'Ngoài registry'}
                  </li>
                ))}
              </ul>
              <p>Runtime kiểm tra quyền riêng cho từng lệnh gọi công cụ.</p>
            </details>
          )}
          <p>Kết quả kiểm thử cục bộ. Phép kiểm tra này không gọi mô hình.</p>
        </div>
      )}
    </section>
  );
}
