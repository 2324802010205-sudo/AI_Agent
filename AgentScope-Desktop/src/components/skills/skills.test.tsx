import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../../App';
import { api } from '../../api';
import type { ExecutionEvent, Skill, SkillState } from '../../types';
import SkillExposure from './SkillExposure';
import SkillManager from './SkillManager';
import { activeSkillsLabel, shortId, stateCounts } from './skillState';

vi.mock('../../api', () => ({
  configureConnection: vi.fn(),
  api: {
    conversations: vi.fn(),
    runs: vi.fn(),
    skills: vi.fn(),
    skill: vi.fn(),
    removeSkill: vi.fn(),
    skillRuntimeSummary: vi.fn(() => Promise.reject(new Error('offline'))),
    settings: vi.fn(),
    audit: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    messages: vi.fn(),
    attachments: vi.fn(),
    events: vi.fn(),
    researchReadiness: vi.fn(() => Promise.reject(new Error('offline'))),
    researchPolicy: vi.fn(() => Promise.reject(new Error('offline'))),
    experiments: vi.fn(() => Promise.resolve([])),
  },
}));

const hash = (n: number) => String(n).padStart(2, '0').repeat(32);
const SKILL_ID = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

function skill(n: number, state: SkillState = 'enabled', name = `skill-${n}`): Skill {
  const status = {
    enabled: 'enabled',
    disabled: 'disabled',
    quarantined: 'quarantine',
    restricted: 'disabled',
  }[state] as Skill['status'];
  return {
    id: SKILL_ID(n),
    name,
    description: `Guidance ${n}`,
    status,
    state,
    eligible: state === 'enabled',
    toggleable: state === 'enabled' || state === 'disabled' || state === 'quarantined',
    package_sha256: hash(n),
    created_at: '2026-11-23T00:00:00Z',
    files: ['SKILL.md'],
    hashes: { 'SKILL.md': hash(n + 50) },
    capabilities: [],
    findings: [],
    security: {
      assessment:
        state === 'enabled' || state === 'disabled'
          ? 'no_significant_findings'
          : 'high_risk_behavior',
      scanned_at: '2026-11-23T00:00:00Z',
      executable_files: [],
      references: [],
      requested_tools: [],
      findings: [],
    },
  };
}

const handlers = () => ({
  onToggle: vi.fn(),
  onOpen: vi.fn(),
  onInspect: vi.fn(),
  onManage: vi.fn(),
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('shows the active count and switches each Skill independently by its ID', () => {
  const skills = Array.from({ length: 10 }, (_, i) =>
    skill(i + 1, i === 2 ? 'disabled' : 'enabled'),
  );
  skills.push(skill(11, 'quarantined', 'flagged'), skill(12, 'restricted', 'limited'));
  const actions = handlers();
  render(<SkillManager skills={skills} pendingIds={new Set([SKILL_ID(7)])} {...actions} />);
  const trigger = screen.getByRole('button', { name: activeSkillsLabel(9) });
  expect(trigger).toHaveTextContent('9 Skills đang bật');
  fireEvent.click(trigger);
  const panel = screen.getByRole('dialog', { name: 'Quản lý Skill' });
  expect(within(panel).getByText('9/12 đang bật')).toBeVisible();
  expect(within(panel).getAllByRole('switch')).toHaveLength(12);

  // Disabled by the user is a switch the user can flip back, with no reinstall.
  const third = within(panel).getByRole('switch', {
    name: new RegExp(`Bật Skill skill-3 \\(${shortId(SKILL_ID(3))}\\)`),
  });
  expect(third).toHaveAttribute('aria-checked', 'false');
  fireEvent.click(third);
  expect(actions.onToggle).toHaveBeenCalledTimes(1);
  expect(actions.onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: SKILL_ID(3) }), true);
  const fourth = within(panel).getByRole('switch', { name: /Tắt Skill skill-4/ });
  expect(fourth).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(fourth);
  expect(actions.onToggle).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: SKILL_ID(4) }),
    false,
  );

  // A pending switch only blocks itself.
  expect(within(panel).getByRole('switch', { name: /Tắt Skill skill-7/ })).toBeDisabled();
  expect(within(panel).getByRole('switch', { name: /Tắt Skill skill-8/ })).toBeEnabled();

  // Quarantined skills remain toggleable for testing/use; only restricted fixtures are locked.
  const quarantinedSwitch = within(panel).getByRole('switch', { name: /Bật Skill flagged/ });
  expect(quarantinedSwitch).toBeEnabled();
  fireEvent.click(quarantinedSwitch);
  expect(actions.onToggle).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: SKILL_ID(11) }),
    true,
  );
  expect(within(panel).getByRole('switch', { name: /Bật Skill limited/ })).toBeDisabled();
  expect(within(panel).getByText('Bật công tắc để AI đọc và sử dụng')).toBeVisible();
  expect(within(panel).getByText('Không được gửi tới model')).toBeVisible();
  expect(within(panel).getByText('Cách ly')).toBeVisible();
  expect(within(panel).getByText('Hạn chế bảo mật')).toBeVisible();
  expect(within(panel).getAllByText('Đã tắt bởi bạn')).toHaveLength(1);
  expect(within(panel).queryByRole('button', { name: /Đánh giá trong Lab/ })).not.toBeInTheDocument();
  expect(within(panel).queryByRole('radio')).not.toBeInTheDocument();
  fireEvent.click(within(panel).getAllByRole('button', { name: /Xem phát hiện/ })[0]);
  expect(actions.onInspect).toHaveBeenCalledWith(expect.objectContaining({ id: SKILL_ID(11) }));
  expect(screen.queryByRole('dialog', { name: 'Quản lý Skill' })).not.toBeInTheDocument();
});

it('keeps Skills with identical display names apart by ID and hash', () => {
  const skills = [skill(1, 'enabled', 'report-helper'), skill(2, 'disabled', 'report-helper')];
  const actions = handlers();
  render(<SkillManager skills={skills} pendingIds={new Set()} {...actions} />);
  fireEvent.click(screen.getByRole('button', { name: activeSkillsLabel(1) }));
  const panel = screen.getByRole('dialog', { name: 'Quản lý Skill' });
  expect(within(panel).getAllByText(/trùng tên/)).toHaveLength(2);
  expect(within(panel).getByText(new RegExp(shortId(SKILL_ID(1))))).toBeVisible();
  expect(within(panel).getByText(new RegExp(shortId(SKILL_ID(2))))).toBeVisible();
  fireEvent.click(
    within(panel).getByRole('switch', {
      name: new RegExp(`Bật Skill report-helper \\(${shortId(SKILL_ID(2))}\\)`),
    }),
  );
  expect(actions.onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: SKILL_ID(2) }), true);
  expect(stateCounts(skills)).toEqual({ enabled: 1, disabled: 1, quarantined: 0, restricted: 0 });
});

it('warns when SkillGuard ON is active and a quarantined Skill is enabled', () => {
  const skills = [{ ...skill(1, 'quarantined', 'risky'), eligible: true }];
  const actions = handlers();
  render(<SkillManager skills={skills} warnFlagged pendingIds={new Set()} {...actions} />);
  fireEvent.click(screen.getByRole('button', { name: activeSkillsLabel(1) }));
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  expect(screen.getByText('Cảnh báo rủi ro · SkillGuard ON sẽ kiểm soát')).toBeVisible();
});

it('switches one Skill from the Skills page without touching the other nine', async () => {
  let library = Array.from({ length: 10 }, (_, i) => skill(i + 1));
  vi.mocked(api.conversations).mockResolvedValue([]);
  vi.mocked(api.runs).mockResolvedValue([]);
  vi.mocked(api.audit).mockResolvedValue([]);
  vi.mocked(api.messages).mockResolvedValue([]);
  vi.mocked(api.attachments).mockResolvedValue({ files: [], selected_ids: [] });
  vi.mocked(api.settings).mockResolvedValue({
    provider: 'openai',
    model: '',
    has_key: false,
    mode: 'demo',
    workspace: 'w',
    network_approval: true,
  });
  vi.mocked(api.skills).mockImplementation(async () => library);
  vi.mocked(api.skill).mockImplementation(async (id, action) => {
    library = library.map((item) =>
      item.id === id
        ? {
            ...item,
            status: action === 'enable' ? 'enabled' : 'disabled',
            state: action === 'enable' ? 'enabled' : 'disabled',
            eligible: action === 'enable',
          }
        : item,
    );
    return library.find((item) => item.id === id)!;
  });
  render(<App />);
  fireEvent.click((await screen.findAllByRole('button', { name: /^Skills/ }))[0]);
  const cardFor = (n: number) =>
    screen.getByText(`skill-${n}`).closest('.skill-card') as HTMLElement;
  await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(10));
  expect(screen.getByText('10 Skills đang bật')).toBeVisible();
  fireEvent.click(within(cardFor(3)).getByRole('switch', { name: /Tắt Skill skill-3/ }));
  await waitFor(() => expect(within(cardFor(3)).getByText('Đã tắt bởi bạn')).toBeVisible());
  expect(api.skill).toHaveBeenCalledTimes(1);
  expect(api.skill).toHaveBeenCalledWith(SKILL_ID(3), 'disable');
  expect(screen.getByText('9 Skills đang bật')).toBeVisible();
  for (const n of [1, 2, 4, 5, 6, 7, 8, 9, 10])
    expect(within(cardFor(n)).getByRole('switch', { name: /Tắt Skill/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  fireEvent.click(within(cardFor(3)).getByRole('switch', { name: /Bật Skill skill-3/ }));
  await waitFor(() => expect(screen.getByText('10 Skills đang bật')).toBeVisible());
  expect(api.skill).toHaveBeenLastCalledWith(SKILL_ID(3), 'enable');
});

it('reports exactly which Skills reached the ACP prompt and why others did not', () => {
  const event = {
    id: 'e1',
    run_id: 'r1',
    step_id: 's1',
    timestamp: '2026-11-23T00:00:00Z',
    source: 'acp',
    event_type: 'prompt.submitted',
    status: 'completed',
    arguments: {},
    message: 'Đã gửi yêu cầu tới Antigravity ACP',
    mode: 'real',
    result: {
      skill_exposure: 'acknowledged',
      skills_in_acp_prompt: 1,
      skills: [
        {
          skill_id: SKILL_ID(1),
          skill_name: 'sent-skill',
          sha256: hash(1),
          exposed: true,
          in_acp_prompt: true,
          skill_exposure: 'acknowledged',
          bundled_files_executed: false,
        },
        {
          skill_id: SKILL_ID(2),
          skill_name: 'long-skill',
          sha256: hash(2),
          exposed: false,
          in_acp_prompt: false,
          skill_exposure: 'not_included',
          reason: 'context_budget_exceeded',
          bundled_files_executed: false,
        },
      ],
      skills_withheld: [
        { skill_id: SKILL_ID(2), skill_name: 'long-skill', reason: 'context_budget_exceeded' },
      ],
      skill_limitations: [
        { code: 'context_budget_exceeded', message: 'Vượt ngân sách ngữ cảnh chung của tác vụ' },
      ],
    },
  } as unknown as ExecutionEvent;
  render(<SkillExposure events={[event]} />);
  expect(screen.getByText(/Skill đã gửi tới Gemini · 1\/2/)).toBeVisible();
  expect(screen.getByText('Đã gửi · khớp trong prompt ACP')).toBeInTheDocument();
  expect(screen.getByText('Chưa gửi · vượt ngân sách ngữ cảnh')).toBeInTheDocument();
  expect(
    screen.getByText(/Toàn bộ nội dung văn bản của các Skill đang bật đã được gửi trong prompt/),
  ).toBeInTheDocument();
});

it('displays per-Skill receipts emitted on skill.delivered events in experiment modes', () => {
  const event = {
    id: 'e2',
    run_id: 'r2',
    step_id: 's2',
    timestamp: '2026-11-25T00:00:00Z',
    source: 'acp',
    event_type: 'skill.delivered',
    status: 'completed',
    arguments: {},
    message: 'Đã gửi yêu cầu và toàn văn 4 Skill tới Antigravity ACP',
    mode: 'real',
    result: {
      skill_exposure: 'acknowledged',
      skills_in_acp_prompt: 4,
      skills: [1, 2, 3, 4].map((n) => ({
        skill_id: SKILL_ID(n),
        skill_name: `biz-skill-${n}`,
        sha256: hash(n),
        exposed: true,
        in_acp_prompt: true,
        skill_exposure: 'acknowledged',
        bundled_files_executed: false,
      })),
      skills_withheld: [],
      skill_limitations: [],
    },
  } as unknown as ExecutionEvent;
  render(<SkillExposure events={[event]} />);
  expect(screen.getByText(/Skill đã gửi tới Gemini · 4\/4/)).toBeVisible();
  expect(screen.getByText(/4 khối khớp SHA-256 trong prompt ACP/)).toBeVisible();
});

beforeEach(() => {
  vi.mocked(api.skillRuntimeSummary).mockRejectedValue(new Error('offline'));
});
