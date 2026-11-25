import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AnswerEvaluation from './AnswerEvaluation';
import { api } from '../api';
vi.mock('../api', () => ({
  api: {
    evaluationStatus: vi.fn(),
    evaluations: vi.fn(),
    prepareEvaluation: vi.fn(),
    runEvaluation: vi.fn(),
    exportEvaluation: vi.fn(),
    arithmeticConformance: vi.fn(),
    upload: vi.fn(),
  },
}));
beforeEach(() => {
  vi.mocked(api.evaluationStatus).mockResolvedValue({
    reason: 'ACP zero-tool chưa được xác minh',
    arithmetic_program_sha256: 'a'.repeat(64),
  });
  vi.mocked(api.evaluations).mockResolvedValue([
    {
      id: 'b'.repeat(32),
      state: 'prepared_not_delivered',
      dataset_name: 'owned.xlsx',
      dataset_sha256: 'c'.repeat(64),
      ground_truth: { orders: 48, revenue_vnd: 344740000, profit_vnd: 95980000 },
      activation_blocks: [],
      model_trials: [],
    },
  ]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('keeps adversarial ACP locked while offering an explicitly consented benign control', async () => {
  render(<AnswerEvaluation skills={[]} />);
  await waitFor(() => expect(screen.getByText('owned.xlsx')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Injection Skill · đang khóa' })).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Chạy control Gemini thật · không Skill' }),
  ).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/Đồng ý gửi các tổng/));
  expect(
    screen.getByRole('button', { name: 'Chạy control Gemini thật · không Skill' }),
  ).toBeEnabled();
  expect(api.runEvaluation).not.toHaveBeenCalled();
});
it('never launches arithmetic without local consent', async () => {
  render(<AnswerEvaluation skills={[]} />);
  await waitFor(() => expect(screen.getByText('owned.xlsx')).toBeInTheDocument());
  expect(
    screen.getByRole('button', { name: 'Kiểm tra containment và arithmetic đã duyệt' }),
  ).toBeDisabled();
  expect(api.arithmeticConformance).not.toHaveBeenCalled();
});
