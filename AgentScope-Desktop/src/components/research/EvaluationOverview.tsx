import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '../../api';
import type {
  EvaluationProportion,
  EvaluationSnapshot,
  ExperimentSummary,
} from '../../types/research';
import { CONDITION_LABELS } from './labels';

const percent = new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: 1 });

function Proportion({ value, name }: { value: EvaluationProportion; name: string }) {
  if (!value.n || !value.wilson95)
    return <small>Chưa có mẫu áp dụng ({value.unavailable} lượt)</small>;
  return (
    <div className="evaluation-proportion">
      <meter min={0} max={1} value={value.hits / value.n} aria-label={name} />
      <strong>
        {value.hits}/{value.n} · {percent.format(value.hits / value.n)}
      </strong>
      <small>
        Wilson 95% {value.wilson95.map((bound) => percent.format(bound)).join('–')}
        {value.unavailable > 0 && ` · ${value.unavailable} lượt thiếu số đo`}
      </small>
    </div>
  );
}

export function EvaluationTable({ snapshot }: { snapshot: EvaluationSnapshot }) {
  return (
    <div className="evaluation-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Chỉ số</th>
            {snapshot.groups.map(({ condition, runs }) => (
              <th scope="col" key={condition}>
                {CONDITION_LABELS[condition]} · {runs} lượt
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(snapshot.metric_labels).map(([key, name]) => (
            <tr key={key}>
              <th scope="row">{name}</th>
              {snapshot.groups.map(({ condition, metrics }) => (
                <td key={condition}>
                  <Proportion
                    value={metrics[key]}
                    name={`${name} · ${CONDITION_LABELS[condition]}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function EvaluationOverview({ items }: { items: ExperimentSummary[] }) {
  const [open, setOpen] = useState(false);
  const [clean, setClean] = useState('');
  const [snapshot, setSnapshot] = useState<EvaluationSnapshot>();
  const [error, setError] = useState('');
  const [exportError, setExportError] = useState('');
  const cleanOptions = new Map(
    items.flatMap((item) =>
      item.skill.skill_md_sha256 ? [[item.skill.skill_md_sha256, item.skill.name] as const] : [],
    ),
  );

  useEffect(() => {
    if (!open) return;
    let active = true;
    setError('');
    setSnapshot(undefined);
    api.evaluationSnapshot(clean).then(
      (data) => {
        if (active) setSnapshot(data);
      },
      (failure: Error) => {
        if (active) setError(failure.message);
      },
    );
    return () => {
      active = false;
    };
  }, [open, clean]);

  const download = async (extension: 'csv' | 'md') => {
    setExportError('');
    try {
      await api.evaluationExport(extension, clean);
    } catch (failure) {
      setExportError((failure as Error).message);
    }
  };

  return (
    <details
      className="lab-plan evaluation-overview"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Đánh giá SkillGuard từ bằng chứng đã lưu</summary>
      <p>
        Các tỷ lệ mô tả bằng chứng trong lịch sử. Điều kiện có thể khác workbook, Skill hoặc model.
      </p>
      {cleanOptions.size > 0 && (
        <label>
          Skill sạch đã xác nhận để tính tỷ lệ chặn nhầm
          <select value={clean} onChange={(event) => setClean(event.target.value)}>
            <option value="">Chưa gắn nhãn</option>
            {Array.from(cleanOptions, ([hash, name]) => (
              <option key={hash} value={hash}>
                {name} · {hash.slice(0, 12)}
              </option>
            ))}
          </select>
        </label>
      )}
      {open && error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {open && !snapshot && !error && <p role="status">Đang đối chiếu bằng chứng…</p>}
      {snapshot && (
        <>
          <div className="row">
            <button className="secondary-button" onClick={() => void download('csv')}>
              <Download size={13} /> CSV từng lượt
            </button>
            <button className="secondary-button" onClick={() => void download('md')}>
              <Download size={13} /> Báo cáo Markdown
            </button>
          </div>
          {exportError && (
            <p className="error-box" role="alert">
              {exportError}
            </p>
          )}
          <EvaluationTable snapshot={snapshot} />
          <small>Biên nhận ACP/MCP gốc nằm trong chi tiết điều kiện của từng thí nghiệm.</small>
        </>
      )}
    </details>
  );
}
