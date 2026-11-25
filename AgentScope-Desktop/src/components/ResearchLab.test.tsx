import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ResearchLab, { evidenceLabel } from './ResearchLab';
import { api } from '../api';
import type { LabPlan } from '../types';

vi.mock('../api', () => ({
  api: {
    labStatus: vi.fn(),
    labPlans: vi.fn(),
    labPrepare: vi.fn(),
    labRun: vi.fn(),
    labExport: vi.fn(),
    upload: vi.fn(),
  },
}));
const plan: LabPlan = {
  id: 'a'.repeat(32),
  state: 'planned_not_run',
  evidence_level: 'not_run',
  workspace: 'fixture',
  model: 'gemini-3.8-flash-high',
  execution_mode: 'auto',
  scenario: 'benign-control',
  skill_sha256: 'b'.repeat(64),
  dataset_sha256: 'c'.repeat(64),
  task: 'Analyze the authorized workbook.',
  trials: {},
  comparison_limits: ['VM reset not yet qualified'],
};
beforeEach(() => {
  vi.mocked(api.labStatus).mockResolvedValue({
    state: 'locked',
    eligible: false,
    reason: 'Chưa có VM được xác minh',
    requirements: ['Dedicated guest'],
    scenarios: [],
    guest_runner_validation: 'not_guest_qualified_in_this_release',
  });
  vi.mocked(api.labPlans).mockResolvedValue([plan]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('keeps baseline and Auto locked even after the consent checkbox is selected', async () => {
  render(<ResearchLab skills={[]} />);
  await waitFor(() => expect(screen.getByText('Chưa có VM được xác minh')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: 'Chạy baseline' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Chạy protected' })).toBeDisabled();
  expect(api.labRun).not.toHaveBeenCalled();
  expect(screen.getAllByText('Chưa có lượt mô hình thật')).toHaveLength(2);
});

it('exports a not-run plan without presenting attack or defense results', async () => {
  vi.mocked(api.labExport).mockResolvedValue(undefined);
  render(<ResearchLab skills={[]} />);
  await waitFor(() => expect(screen.getByText('fixture · benign-control')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Xuất evidence ZIP và báo cáo' }));
  await waitFor(() => expect(api.labExport).toHaveBeenCalledWith(plan.id));
  expect(api.labRun).not.toHaveBeenCalled();
});

it('never promotes unit evidence or a missing OS witness into prevention', () => {
  expect(
    evidenceLabel({
      evidence_level: 'unit_test',
      outcome: { classification: 'unauthorized_request_prevented', prevention: true },
    }),
  ).toContain('Chưa có hoạt động mô hình');
  expect(
    evidenceLabel({
      evidence_level: 'real_model_observed',
      outcome: { classification: 'denial_observed_prevention_unconfirmed', prevention: false },
    }),
  ).toBe('denial_observed_prevention_unconfirmed');
  expect(
    evidenceLabel({
      evidence_level: 'real_model_observed',
      outcome: { classification: 'model_noncompliance', prevention: false },
    }),
  ).toContain('không phải thành công SkillGuard');
});
