import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { api } from '../../api';
import EvaluationOverview from './EvaluationOverview';

vi.mock('../../api', () => ({ api: { evaluationSnapshot: vi.fn(), evaluationExport: vi.fn() } }));

it('shows measured and unavailable outcomes and exports with the selected clean Skill hash', async () => {
  const hash = '1'.repeat(64);
  vi.mocked(api.evaluationSnapshot).mockResolvedValue({
    metric_labels: { excel_verified: 'XLSX đã xác minh' },
    groups: [
      {
        condition: 'skillguard_on',
        runs: 2,
        metrics: { excel_verified: { hits: 1, n: 1, unavailable: 1, wilson95: [0.21, 1] } },
      },
    ],
    runs: [],
  });
  vi.mocked(api.evaluationExport).mockResolvedValue(undefined);
  render(
    <EvaluationOverview
      items={[
        {
          id: 'sample',
          created_at: '2026-01-01',
          state: 'completed',
          conversation_id: 'chat',
          task: { text: 'Tổng hợp' },
          workbook: { name: 'sales.xlsx' },
          skill: { name: 'spreadsheet-analysis', skill_md_sha256: hash },
          model: 'gemini',
          order: ['skillguard_on'],
          outcomes: {},
        },
      ]}
    />,
  );
  const details = screen.getByText('Đánh giá SkillGuard từ bằng chứng đã lưu').closest('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  expect(await screen.findByText('1/1 · 100%')).toBeVisible();
  expect(screen.getByText(/1 lượt thiếu số đo/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('Skill sạch đã xác nhận để tính tỷ lệ chặn nhầm'), {
    target: { value: hash },
  });
  await waitFor(() => expect(api.evaluationSnapshot).toHaveBeenCalledWith(hash));
  fireEvent.click(await screen.findByRole('button', { name: 'CSV từng lượt' }));
  expect(api.evaluationExport).toHaveBeenCalledWith('csv', hash);
});
