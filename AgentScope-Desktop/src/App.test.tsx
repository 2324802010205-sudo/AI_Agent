import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import App from './App';
import { api, configureConnection } from './api';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./api', () => ({
  configureConnection: vi.fn(),
  developmentBackendUrl: 'http://127.0.0.1:8765',
  api: {
    conversations: vi.fn(),
    runs: vi.fn(),
    skills: vi.fn(),
    skillRuntimeSummary: vi.fn(() => Promise.reject(new Error('offline'))),
    skill: vi.fn(),
    skillSource: vi.fn(),
    reviewIsolatedSkill: vi.fn(),
    settings: vi.fn(),
    audit: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    messages: vi.fn(),
    attachments: vi.fn(),
    createConversation: vi.fn(),
    send: vi.fn(),
    events: vi.fn(),
    saveSettings: vi.fn(),
    testProvider: vi.fn(),
    testModel: vi.fn(),
    antigravityStatus: vi.fn(),
    antigravityModels: vi.fn(),
    importSkill: vi.fn(),
    removeSkill: vi.fn(),
    researchReadiness: vi.fn(() => Promise.reject(new Error('offline'))),
    researchPolicy: vi.fn(() => Promise.reject(new Error('offline'))),
    experiments: vi.fn(() => Promise.resolve([])),
  },
}));
beforeEach(() => {
  vi.mocked(api.conversations).mockResolvedValue([]);
  vi.mocked(api.runs).mockResolvedValue([]);
  vi.mocked(api.skills).mockResolvedValue([]);
  vi.mocked(api.audit).mockResolvedValue([]);
  vi.mocked(api.messages).mockResolvedValue([]);
  vi.mocked(api.attachments).mockResolvedValue({ files: [], selected_ids: [] });
  vi.mocked(api.events).mockResolvedValue([]);
  vi.mocked(api.settings).mockResolvedValue({
    provider: 'openai',
    model: '',
    has_key: false,
    mode: 'demo',
    workspace: 'test-workspace',
    network_approval: true,
  });
});
it('uses the Tauri connection for startup, retry and health checks on Windows', async () => {
  const connection = { url: 'http://127.0.0.1:43123', token: 'native-session' };
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  vi.mocked(invoke).mockRejectedValueOnce('Backend đã dừng.').mockResolvedValue(connection);
  try {
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Cài đặt' })[0]);
    expect(await screen.findByText('Backend đã dừng.')).toBeVisible();
    expect(screen.queryByLabelText('Mã phiên phát triển')).not.toBeInTheDocument();
    expect(invoke).toHaveBeenNthCalledWith(1, 'backend_connection', { retry: false });
    fireEvent.click(screen.getByRole('button', { name: 'Kết nối lại' }));
    expect(await screen.findByRole('button', { name: 'Kiểm tra kết nối' })).toBeEnabled();
    expect(invoke).toHaveBeenNthCalledWith(2, 'backend_connection', { retry: true });
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));
    await waitFor(() => expect(configureConnection).toHaveBeenCalledTimes(2));
    expect(vi.mocked(configureConnection).mock.calls).toEqual([
      [connection.url, connection.token],
      [connection.url, connection.token],
    ]);
  } finally {
    vi.unstubAllGlobals();
  }
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('shows unmediated runtime evidence in Security without claiming policy approval', async () => {
  vi.mocked(api.audit).mockResolvedValue([
    {
      id: 'unmediated',
      run_id: 'r',
      step_id: 's',
      timestamp: new Date().toISOString(),
      source: 'skillguard',
      event_type: 'security.unmediated_tool',
      status: 'completed',
      arguments: {},
      result: { enforced: false },
      message: 'CLI reported an unmediated read',
      mode: 'real',
    },
  ]);
  render(<App />);
  await waitFor(() => expect(screen.getByText('Demo · không gọi AI')).toBeInTheDocument());
  fireEvent.click(screen.getAllByRole('button', { name: 'Bảo mật' })[0]);
  await waitFor(() => expect(screen.getByText('Không qua SkillGuard')).toBeInTheDocument());
  expect(screen.getByText('CLI reported an unmediated read')).toBeInTheDocument();
  expect(screen.queryByText('Chính sách cho phép')).not.toBeInTheDocument();
});
describe('AgentScope workspace', () => {
  it('shows Vietnamese greeting and disables empty submission', async () => {
    render(<App />);
    expect(screen.getByText(/Hôm nay, mình có thể giúp gì/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi tin nhắn' })).toBeDisabled();
    await waitFor(() => expect(screen.getByText('Demo · không gọi AI')).toBeInTheDocument());
  });
  it('quick report action prepares an editable request', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Tạo báo cáo' }));
    expect(screen.getByRole('textbox', { name: 'Tin nhắn cho AI Assistant' })).toHaveValue(
      'Tạo báo cáo Excel tổng hợp từ tệp đính kèm.',
    );
    expect(screen.getByRole('button', { name: 'Gửi tin nhắn' })).toBeEnabled();
  });
  it('navigates to functional Skill manager', async () => {
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Skills' })[0]);
    expect(screen.getByRole('button', { name: 'Nhập Skill' })).toBeInTheDocument();
    expect(screen.getByText('SKILL.md hoặc ZIP')).toBeInTheDocument();
    await waitFor(() => expect(api.skills).toHaveBeenCalled());
  });
  it('warns in SkillGuard ON when a quarantined Skill is enabled and lets users inspect it', async () => {
    const quarantinedSkill = {
      id: 'restricted',
      name: 'spreadsheet-review',
      description: 'Spreadsheet review fixture',
      status: 'quarantine' as const,
      eligible: true,
      toggleable: true,
      package_sha256: 'a'.repeat(64),
      created_at: '2026-11-23T00:00:00Z',
      files: ['SKILL.md'],
      hashes: {},
      capabilities: [],
      findings: [],
      security: {
        assessment: 'high_risk_behavior' as const,
        scanned_at: '2026-11-23T00:00:00Z',
        executable_files: [],
        references: [],
        requested_tools: [],
        findings: [
          {
            code: 'bundled_code',
            category: 'high_risk_behavior' as const,
            path: 'scripts/fixture.py',
            line: null,
            message: 'Static fixture.',
          },
        ],
      },
    };
    vi.mocked(api.skills).mockResolvedValue([quarantinedSkill]);
    render(<App />);
    const trigger = await screen.findByRole('button', { name: /1 Skills đang bật/ });
    expect(screen.queryByRole('combobox', { name: 'Skill cho tác vụ' })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    const manager = screen.getByRole('dialog', { name: 'Quản lý Skill' });
    expect(within(manager).getByText('Cách ly')).toBeVisible();
    expect(within(manager).getByText('Đang bật · sẽ gửi toàn bộ nội dung Skill tới AI')).toBeVisible();
    expect(
      within(manager).getByRole('switch', { name: /Tắt Skill spreadsheet-review/ }),
    ).toBeEnabled();
    expect(within(manager).queryByRole('radio', { name: 'Thử nghiệm' })).not.toBeInTheDocument();
    expect(within(manager).queryByRole('button', { name: /Đánh giá trong Lab/ })).not.toBeInTheDocument();
    fireEvent.click(trigger);

    // Switching to SkillGuard ON immediately warns the user about enabled risky Skills.
    fireEvent.click(screen.getByRole('radio', { name: 'Protected Test' }));
    expect(screen.getByText(/Cảnh báo SkillGuard ON · spreadsheet-review/)).toBeVisible();
    expect(screen.getByText('scripts/fixture.py')).toBeVisible();

    vi.mocked(api.skillSource).mockResolvedValue({ content: 'Read-only test fixture.' });
    fireEvent.click(screen.getByRole('radio', { name: 'Chat thường' }));
    fireEvent.click(screen.getByRole('button', { name: /1 Skills đang bật/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Mở spreadsheet-review/ }));
    expect(screen.getByRole('dialog', { name: 'Nội dung Skill' })).toBeVisible();
    fireEvent.keyDown(window, { key: 'Escape' });
    const prompt = screen.getByRole('textbox', { name: 'Tin nhắn cho AI Assistant' });
    fireEvent.change(prompt, { target: { value: 'Tổng hợp workbook' } });
    expect(screen.getByRole('button', { name: 'Gửi tin nhắn' })).toBeEnabled();
  });
  it('shows an empty execution center and lets the user collapse it', () => {
    render(<App />);
    expect(screen.getByText('Chọn một tác vụ để xem dòng thời gian.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ẩn bảng thực thi' }));
    expect(screen.queryByText('Trung tâm thực thi')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mở bảng thực thi' }));
    expect(screen.getByText('Trung tâm thực thi')).toBeInTheDocument();
  });
  it('sends through the backend and preserves submitted content', async () => {
    vi.mocked(api.createConversation).mockResolvedValue({
      id: 'c1',
      title: 'new',
      created_at: new Date().toISOString(),
    });
    vi.mocked(api.send).mockImplementation(async (_id, content) => ({
      message: {
        id: 'm1',
        role: 'user',
        content,
        created_at: new Date().toISOString(),
      },
      run: {
        id: 'r1',
        conversation_id: 'c1',
        title: content,
        status: 'pending',
        mode: 'demo',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    }));
    render(<App />);
    await waitFor(() => expect(screen.getByText('Demo · không gọi AI')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('textbox', { name: 'Tin nhắn cho AI Assistant' }), {
      target: { value: 'Xin chào AgentScope' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi tin nhắn' }));
    await waitFor(() => expect(api.send).toHaveBeenCalledWith('c1', 'Xin chào AgentScope', []));
  });
  it('renders Antigravity ACP settings and supports model selection and testing', async () => {
    vi.mocked(api.settings).mockResolvedValue({
      provider: 'antigravity',
      model: 'gemini-4-neon-high',
      has_key: true,
      mode: 'real',
      workspace: 'test-workspace',
      network_approval: true,
      antigravity: {
        installed: true,
        ready: true,
        version: '1.5.9',
        path: 'C:\\Users\\ADMIN\\AppData\\Local\\agy\\bin\\agy.exe',
        message: 'Đã phát hiện Antigravity CLI v1.5.9',
        models: [
          { id: 'gemini-4-neon-high', name: 'Gemini 4 Neon (High)' },
          { id: 'claude-sonnet-5-5-high', name: 'Claude Sonnet 5.5 (High)' },
        ],
        current_model: 'gemini-4-neon-high',
      },
    });
    vi.mocked(api.testProvider).mockResolvedValue({
      message: 'Kết nối Antigravity thành công (v1.5.9 · claude-sonnet-5-5-high). Phản hồi thực tế trong 420ms.',
      provider: 'antigravity',
      model: 'claude-sonnet-5-5-high',
      duration_ms: 420,
      response: 'OK',
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText('ACP sẵn sàng · chưa có phản hồi AI')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Cài đặt' })[0]);
    await waitFor(() => expect(screen.getByText('Antigravity ACP Runtime')).toBeInTheDocument());
    expect(screen.getByText('Đã kết nối · v1.5.9')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Tự chọn từ phiên ACP' })).toHaveValue('');
    const modelSelect = screen.getByLabelText('Model Antigravity');
    fireEvent.change(modelSelect, { target: { value: 'claude-sonnet-5-5-high' } });
    expect(screen.getByRole('button', { name: 'Kiểm tra Antigravity' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra Antigravity' }));
    await waitFor(() => expect(api.testProvider).toHaveBeenCalledWith('claude-sonnet-5-5-high'));
    expect(await screen.findByText(/claude-sonnet-5-5-high đã phản hồi/)).toBeVisible();
  });
  it('tests the draft API configuration without saving and clears feedback when it changes', async () => {
    vi.mocked(api.testModel)
      .mockResolvedValueOnce({
        provider: 'gemini',
        model: 'test-model',
        duration_ms: 420,
        response: 'OK',
      })
      .mockRejectedValueOnce(new Error('Provider API trả HTTP 401.'));
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Cài đặt' })[0]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu cấu hình' })).toBeEnabled());
    const provider = screen.getByLabelText('Dịch vụ AI');
    fireEvent.change(provider, { target: { value: 'gemini' } });
    const key = screen.getByLabelText('API key');
    const model = screen.getByRole('textbox', { name: 'Model ID' });
    const test = screen.getByRole('button', { name: 'Test model' });
    expect(test).toBeDisabled();
    fireEvent.change(model, { target: { value: ' test-model ' } });
    fireEvent.change(key, { target: { value: ' draft-key ' } });
    fireEvent.click(test);
    expect(await screen.findByText('test-model đã phản hồi · 420 ms')).toBeVisible();
    expect(api.testModel).toHaveBeenCalledWith({
      provider: 'gemini',
      model: 'test-model',
      api_key: 'draft-key',
    });
    expect(api.saveSettings).not.toHaveBeenCalled();
    expect(api.testProvider).not.toHaveBeenCalled();
    fireEvent.change(provider, { target: { value: 'anthropic' } });
    expect(key).toHaveValue('');
    expect(model).toHaveValue('');
    expect(screen.queryByText('test-model đã phản hồi · 420 ms')).not.toBeInTheDocument();
    fireEvent.change(model, { target: { value: 'another-model' } });
    fireEvent.click(test);
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 401');
    expect(api.testModel).toHaveBeenLastCalledWith({
      provider: 'anthropic',
      model: 'another-model',
      api_key: undefined,
    });
  });
});

it('renders real streamed snapshots and keeps the final response on event replay', async () => {
  const stamp = new Date().toISOString();
  const settings = {
    provider: 'antigravity',
    model: '',
    mode: 'real' as const,
    has_key: true,
    workspace: 'test',
    network_approval: true,
    antigravity: { installed: true, ready: false, message: 'not tested' },
  };
  vi.mocked(api.settings).mockResolvedValue(settings);
  vi.mocked(api.createConversation).mockResolvedValue({
    id: 'live-conversation',
    title: 'new',
    created_at: stamp,
  });
  const run = {
    id: 'live-run',
    conversation_id: 'live-conversation',
    title: 'chào',
    status: 'running' as const,
    mode: 'real' as const,
    provider: 'antigravity',
    created_at: stamp,
    updated_at: stamp,
  };
  vi.mocked(api.runs).mockResolvedValue([run]);
  vi.mocked(api.send).mockResolvedValue({
    run,
    message: {
      id: 'user-live',
      conversation_id: 'live-conversation',
      role: 'user',
      content: 'chào',
      created_at: stamp,
    },
  });
  render(<App />);
  await waitFor(() => expect(screen.getByText('AI chưa xác minh')).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Tin nhắn cho AI Assistant'), {
    target: { value: 'chào' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi tin nhắn' }));
  await waitFor(() => expect(api.subscribe).toHaveBeenCalled());
  const callback = vi.mocked(api.subscribe).mock.calls.at(-1)![1];
  const message = {
    id: 'assistant-live',
    conversation_id: 'live-conversation',
    role: 'assistant' as const,
    content: 'Provider stream',
    created_at: stamp,
    streaming: true,
    revision: 1,
  };
  const event = {
    id: 'delta',
    run_id: run.id,
    step_id: 's',
    timestamp: stamp,
    source: 'runtime',
    event_type: 'provider.response.streaming',
    status: 'running' as const,
    arguments: {},
    result: { message },
    message: 'Receiving AI text',
    mode: 'real' as const,
  };
  await act(async () => callback(event));
  expect(screen.getByText('Provider stream')).toBeInTheDocument();
  expect(screen.getByText('Đang nhận phản hồi…')).toBeInTheDocument();
  expect(screen.queryByText(/Các bước dưới đây/)).not.toBeInTheDocument();
  await act(async () =>
    callback({
      ...event,
      id: 'final',
      event_type: 'message.created',
      result: {
        message: {
          ...message,
          content: 'Provider completed',
          revision: 2,
          streaming: false,
        },
      },
    }),
  );
  await act(async () => callback(event));
  expect(screen.getByText('Provider completed')).toBeInTheDocument();
  expect(screen.queryByText('Provider stream')).not.toBeInTheDocument();
  expect(screen.queryByText('Đang nhận phản hồi…')).not.toBeInTheDocument();
  vi.mocked(api.settings).mockResolvedValue({
    ...settings,
    antigravity: {
      installed: true,
      ready: true,
      authenticated: true,
      version: 'observed-version',
      message: 'Authenticated reply observed',
      models: [{ id: 'actual-discovered', name: 'Observed model' }],
    },
  });
  await act(async () =>
    callback({
      ...event,
      id: 'terminal',
      event_type: 'run.status',
      status: 'completed',
      result: { status: 'completed' },
    }),
  );
  await waitFor(() => expect(screen.getByText('AI đã phản hồi')).toBeInTheDocument());
  fireEvent.click(screen.getAllByRole('button', { name: 'Cài đặt' })[0]);
  await waitFor(() =>
    expect(screen.getByText('Đã kết nối · vobserved-version')).toBeInTheDocument(),
  );
  expect(
    screen.getByRole('option', { name: 'Observed model (actual-discovered)' }),
  ).toBeInTheDocument();
});

it('shows the real build version and flags a stale backend sidecar', async () => {
  vi.mocked(api.settings).mockResolvedValue({
    provider: 'openai',
    model: '',
    has_key: false,
    mode: 'real',
    workspace: 'w',
    network_approval: true,
    backend_version: '0.0.9',
  });
  render(<App />);
  await waitFor(() =>
    expect(screen.getByText(`AgentScope v${__APP_VERSION__} · backend v0.0.9`)).toBeInTheDocument(),
  );
});
