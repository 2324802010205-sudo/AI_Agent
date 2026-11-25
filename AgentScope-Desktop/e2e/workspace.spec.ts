import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
test('desktop workspace: import Skill, execute real CSV, download report and remove Skill', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    const sockets: WebSocket[] = [];
    Object.defineProperty(window, '__agentScopeTestSockets', { value: sockets });
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
      }
    };
  });
  await page.goto('/');
  await expect(page.getByText('Hôm nay, mình có thể giúp gì?', { exact: false })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('workspace-1480.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Cài đặt', exact: true }).click();
  const token = readFileSync(
    process.env.AGENTSCOPE_SESSION_TOKEN_FILE ||
      path.resolve('../AgentScope-Backend/.agentscope/session-token'),
    'utf8',
  ).trim();
  await page.getByLabel('Mã phiên phát triển').fill(token);
  await page.getByRole('button', { name: 'Kết nối backend', exact: true }).click();
  await expect(page.locator('.title-status')).not.toContainText('Backend chưa kết nối');
  await expect(page.locator('.title-status')).not.toContainText('Đang kết nối');
  await page.getByLabel('Dịch vụ AI').selectOption('openai');
  await page.getByRole('button', { name: 'Lưu cấu hình', exact: false }).click();
  await page.getByRole('button', { name: 'Thực thi thực tế', exact: false }).click();
  await page
    .locator('nav')
    .getByRole('button', { name: /Skills/ })
    .click();
  await page
    .locator('input[type=file][accept=".md,.zip"]')
    .setInputFiles('e2e/fixtures/spreadsheet-analysis/SKILL.md');
  await expect(page.locator('.skill-card').getByText('Đang bật', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const skillCard = page.locator('.skill-card').filter({ hasText: 'spreadsheet-analysis' });
  await skillCard.getByRole('button', { name: 'Chi tiết Skill' }).click();
  const details = page.getByRole('dialog', { name: 'Thông tin Skill' });
  await details.getByRole('button', { name: 'Mở Skill', exact: true }).click();
  const source = page.getByRole('dialog', { name: 'Nội dung Skill' });
  await expect(source.locator('pre')).toContainText('name: spreadsheet-analysis');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page
    .locator('input[type=file][accept=".csv,.xlsx,.xls"]')
    .setInputFiles('public/samples/doanh-thu.csv');
  await expect(page.getByRole('button', { name: 'doanh-thu.csv', exact: true })).toBeVisible();
  await page
    .getByLabel('Tin nhắn cho AI Assistant')
    .fill('Phân tích doanh thu và tạo báo cáo Excel');
  await expect(page.getByLabel('Skill cho tác vụ')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '1 Skills đang bật' })).toBeVisible();
  const submission = page.waitForRequest((request) =>
    request.method() === 'POST' && /\/api\/conversations\/[^/]+\/messages$/.test(request.url()),
  );
  await page.getByRole('button', { name: 'Gửi tin nhắn' }).click();
  const payload = (await submission).postDataJSON();
  expect(payload.auto_skill).toBe(true);
  expect(payload).not.toHaveProperty('skill_id');
  await expect(page.getByText(/Đã phân tích 9 dòng dữ liệu/)).toBeVisible({ timeout: 15000 });
  await expect(
    page.locator('.timeline').getByText('Đã tạo tệp báo cáo Excel', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.execution-overview')).toContainText('spreadsheet-analysis');
  await page.screenshot({
    path: testInfo.outputPath('execution-1480.png'),
    fullPage: true,
    animations: 'disabled',
  });
  const timelineCount = await page.locator('.timeline-event').count();
  const socketCount = await page.evaluate(
    () =>
      (window as unknown as { __agentScopeTestSockets: WebSocket[] }).__agentScopeTestSockets
        .length,
  );
  await page.evaluate(() =>
    (window as unknown as { __agentScopeTestSockets: WebSocket[] }).__agentScopeTestSockets
      .at(-1)
      ?.close(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __agentScopeTestSockets: WebSocket[] }).__agentScopeTestSockets
            .length,
      ),
    )
    .toBeGreaterThan(socketCount);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { __agentScopeTestSockets: WebSocket[] }
          ).__agentScopeTestSockets.at(-1)?.readyState,
      ),
    )
    .toBe(1);
  await expect(page.locator('.timeline-event')).toHaveCount(timelineCount);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('.result-card').first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  await download.saveAs(testInfo.outputPath('e2e-report.xlsx'));
  await page.locator('nav').getByRole('button', { name: 'Lịch sử & Kết quả', exact: true }).click();
  await page.getByRole('tab', { name: 'Báo cáo Excel', exact: true }).click();
  await expect(
    page.locator('.report-card').filter({ hasText: download.suggestedFilename() }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Cuộc trò chuyện & nhật ký', exact: true }).click();
  await expect(page.locator('.history-grid')).toContainText('Excel');
  await page.getByRole('tab', { name: 'Tác vụ', exact: true }).click();
  await page.locator('.task-row').filter({ hasText: 'Excel' }).first().click();
  await expect(page.locator('.result-card').first()).toBeVisible();

  const entries = page.locator('.timeline-event');
  const read = entries
    .filter({ has: page.locator('summary').getByText('Đã đọc dữ liệu bảng tính', { exact: true }) })
    .first();
  const reportEntry = entries
    .filter({ has: page.locator('summary').getByText('Đã tạo tệp báo cáo Excel', { exact: true }) })
    .first();
  await read.locator(':scope > summary').click();
  await reportEntry.locator(':scope > summary').click();
  await expect(read).toHaveAttribute('open', '');
  await expect(reportEntry).toHaveAttribute('open', '');
  await expect(read.getByRole('heading', { name: 'Chi tiết sự kiện' })).toBeVisible();
  await read.locator(':scope > summary').click();
  await expect(read).not.toHaveAttribute('open', '');
  await expect(reportEntry).toHaveAttribute('open', '');
  await page.getByRole('button', { name: 'Bảo mật', exact: true }).click();
  await page.getByRole('button', { name: 'Chạy tình huống demo' }).click();
  await expect(
    page.getByText('Đã chặn kết nối tới đích chưa được cấp quyền.', { exact: false }).first(),
  ).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.locator('nav').getByRole('button', { name: 'Chat', exact: true })).toHaveClass(
    /selected/,
  );
  const thread = page.locator('.activity-thread').first();
  if ((await thread.getAttribute('open')) === null)
    await thread.locator(':scope > summary').click();
  await expect(thread.locator('.activity-step summary').getByText('Đã xác minh')).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('workspace-1280.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page
    .locator('nav')
    .getByRole('button', { name: /Skills/ })
    .click();
  await skillCard.getByRole('switch', { name: /^Tắt Skill spreadsheet-analysis/ }).click();
  await expect(skillCard.getByText('Đã tắt bởi bạn', { exact: true })).toBeVisible();
  await skillCard.getByRole('button', { name: 'Chi tiết Skill' }).click();
  await details.getByRole('button', { name: 'Mở Skill', exact: true }).click();
  await expect(source.locator('pre')).toContainText('name: spreadsheet-analysis');
  await page.keyboard.press('Escape');
  await skillCard.getByRole('button', { name: 'Gỡ Skill' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Gỡ Skill' });
  await expect(confirmation).toContainText('spreadsheet-analysis');
  await confirmation.getByRole('button', { name: 'Xác nhận gỡ Skill' }).click();
  await expect(skillCard).toHaveCount(0);
  expect(errors).toEqual([]);
});
