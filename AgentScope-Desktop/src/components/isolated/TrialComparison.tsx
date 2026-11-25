import type { IsolatedTrial } from '../../types';
import { FOLLOWUP_CASES, conditionLabel, decisionConfig } from './labels';

export default function TrialComparison({
  trials,
  view,
}: {
  trials: IsolatedTrial[];
  view?: IsolatedTrial['data_view'];
}) {
  const groups = trials.reduce<Record<string, IsolatedTrial[]>>((groups, trial) => {
    const label = trial.case
      ? `${FOLLOWUP_CASES[trial.case]}${decisionConfig(trial)} · ${trial.kind.toUpperCase()}`
      : conditionLabel(trial);
    (groups[label] ??= []).push(trial);
    return groups;
  }, {});
  return (
    <div className="boundary-comparison">
      <table>
        <caption>
          Kết quả quan sát theo điều kiện
          {view
            ? ` · ${view === 'native_tools' ? 'Công cụ native ACP' : view === 'raw_rows' ? 'Toàn bộ dòng Excel' : 'Tổng hợp Python'}`
            : ''}
        </caption>
        <thead>
          <tr>
            <th>Điều kiện</th>
            <th>Hoàn tất</th>
            <th>Khớp số liệu</th>
            <th>Nội dung thử nghiệm qua ACP</th>
            <th>Phân loại</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(groups).map(([label, group]) => {
            const counts = group.reduce<Record<string, number>>((result, t) => {
              const label =
                t.boundary_assessment?.outcome ||
                t.boundary_assessment?.classification ||
                'INCONCLUSIVE';
              result[label] = (result[label] || 0) + 1;
              return result;
            }, {});
            return (
              <tr key={label}>
                <th>{label}</th>
                <td>
                  {group.filter((t) => t.state === 'completed').length}/{group.length}
                </td>
                <td>
                  {group.filter((t) => t.signals?.validation.valid).length}/{group.length}
                </td>
                <td>
                  {
                    group.filter(
                      (t) =>
                        (t.delivery.skill_included ||
                          t.delivery.record_notes_included ||
                          (t.kind !== 'control' && t.delivery.guidance_cell_included)) &&
                        (t.delivery.prompt_completed ?? Boolean(t.turn?.prompt_submitted_at)),
                    ).length
                  }
                  /{group.length}
                </td>
                <td>
                  {Object.entries(counts)
                    .map(([label, count]) => `${label} (${count})`)
                    .join(', ') || '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
