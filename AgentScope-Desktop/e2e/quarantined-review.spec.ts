import { expect, test, type Request } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

test('opens an explicitly authorized read-only Skill review from Normal Chat', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Cài đặt', exact: true }).click();
  const token = readFileSync(
    process.env.AGENTSCOPE_SESSION_TOKEN_FILE ||
      path.resolve('../AgentScope-Backend/.agentscope/session-token'),
    'utf8',
  ).trim();
  await page.getByLabel('Mã phiên phát triển').fill(token);
  await page.getByRole('button', { name: 'Kết nối backend', exact: true }).click();
  await expect(page.locator('.title-status')).not.toContainText('Backend chưa kết nối');
  const nav = page.locator('nav');
  await nav.getByRole('button', { name: /^Skills/ }).click();
  await page.locator('input[type=file][accept=".md,.zip"]').setInputFiles({
    name: 'SKILL.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '---\nname: offline-review-fixture\ndescription: Incomplete fixture for static inspection.\n---\n<b>raw marker</b>\n```python\nkeyboard.Listener(\n',
    ),
  });
  const card = page.locator('.skill-card').filter({ hasText: 'offline-review-fixture' });
  await expect(card).toBeVisible();
  await expect(card.getByText('Cách ly', { exact: true })).toBeVisible();
  await expect(card.getByRole('switch')).toBeDisabled();
  await expect(card).not.toContainText(/Dấu hiệu rủi ro cao/);
  await page.locator('input[type=file][accept=".md,.zip"]').setInputFiles({
    name: 'SKILL.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '---\nname: concise-report-fixture\ndescription: Concise reporting.\n---\nUse a short heading.\n',
    ),
  });
  const companion = page.locator('.skill-card').filter({ hasText: 'concise-report-fixture' });
  await companion.getByRole('switch', { name: /^Tắt Skill concise-report-fixture/ }).click();
  await expect(companion.getByText('Đã tắt bởi bạn', { exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Chat', exact: true }).click();
  const picker = page.getByRole('combobox', { name: 'Skill cho tác vụ' });
  await expect(picker).toHaveCount(0);
  await page
    .locator('input[type=file][accept=".csv,.xlsx,.xls"]')
    .setInputFiles('e2e/fixtures/research-sales.xlsx');
  const workbook = page.getByRole('button', { name: 'research-sales.xlsx', exact: true });
  await expect(workbook).toBeVisible();
  const prompt = page.getByRole('textbox', { name: 'Tin nhắn cho AI Assistant' });
  await prompt.fill('Tổng hợp workbook');
  const warning = page.locator('.composer-restriction');
  await expect(warning).toHaveCount(0);
  const send = page.getByRole('button', { name: 'Gửi tin nhắn', exact: true });
  await expect(send).toBeEnabled();
  await expect(send).toHaveText('');
  await expect
    .poll(() => page.locator('.composer').evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: /Skills đang bật$/ }).click();
  const library = page.getByRole('dialog', { name: 'Quản lý Skill' });
  await expect(library.getByText('concise-report-fixture')).toBeVisible();
  await expect(library.locator('li').filter({ hasText: 'concise-report-fixture' })).toContainText(
    'Đã tắt bởi bạn',
  );
  await expect(library.locator('li').filter({ hasText: 'offline-review-fixture' })).toContainText(
    'Cách ly',
  );
  await library.getByRole('button', { name: /^Mở offline-review-fixture/ }).click();
  const preview = page.getByRole('dialog', { name: 'Nội dung Skill' });
  const source = preview.locator('pre');
  await expect(source).toContainText('<b>raw marker</b>');
  await expect(source.locator('b')).toHaveCount(0);
  await expect(preview.getByRole('status')).toContainText('Dấu hiệu rủi ro cao');
  await preview.getByText('Xem phát hiện', { exact: true }).click();
  await expect(preview.getByText('Tệp trong bản lưu · SHA-256')).toBeVisible();
  const modelRequests: string[] = [];
  const trackExecution = (request: Request) => {
    if (
      request.method() === 'POST' &&
      /\/(messages|experiments|trials)(?:\/|$)/.test(new URL(request.url()).pathname)
    ) {
      modelRequests.push(request.url());
    }
  };
  page.on('request', trackExecution);
  await preview.getByRole('button', { name: 'Đánh giá trong Lab' }).click();
  const dialog = page.getByRole('dialog', { name: 'Đánh giá chỉ đọc trong Lab' });
  const start = dialog.getByRole('button', { name: 'Bắt đầu rà soát chỉ đọc' });
  await expect(start).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  const created = page.waitForResponse((response) => response.url().endsWith('/isolated-reviews'));
  await start.click();
  const receipt = await (await created).json();
  expect(receipt).toMatchObject({
    conversation_id: expect.any(String),
    evidence_type: 'local_static_review',
    status: 'quarantine',
    provider: 'not_called',
    model_exposure: 'not_submitted',
    tool_execution: 'not_run',
  });
  await expect(dialog.getByText('Đã lưu biên nhận · Skill vẫn đang cách ly')).toBeVisible();
  await expect(dialog.getByText('Chưa gửi nội dung')).toBeVisible();
  await expect(dialog.getByText('Mã biên nhận')).toBeVisible();
  expect(modelRequests).toEqual([]);
  page.off('request', trackExecution);
  await page.keyboard.press('Escape');

  for (const mode of ['Unprotected Model Test', 'So sánh cả hai']) {
    await page.getByRole('radio', { name: mode, exact: true }).click();
    await expect(warning).toHaveCount(0);
  }
  await page.getByRole('radio', { name: 'Protected Test', exact: true }).click();
  await page.getByRole('button', { name: /Skills đang bật$/ }).click();
  await page
    .getByRole('dialog', { name: 'Quản lý Skill' })
    .locator('li')
    .filter({ hasText: 'offline-review-fixture' })
    .getByRole('radio', { name: 'Thử nghiệm' })
    .check();
  await page.getByRole('button', { name: /Skills đang bật$/ }).click();
  await expect(warning).toContainText('Dấu hiệu rủi ro cao');
  await expect(warning).toContainText('SKILL.md');
  await nav.getByRole('button', { name: /^Skills/ }).click();
  await expect(card).toContainText('Dấu hiệu rủi ro cao');
  await nav.getByRole('button', { name: 'Chat', exact: true }).click();
  await warning.getByRole('button', { name: 'Xem phát hiện' }).click();
  await expect(page.getByRole('dialog', { name: 'Thông tin Skill' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(warning.getByRole('button', { name: 'Đánh giá trong Lab' })).toBeVisible();

  await page.getByRole('radio', { name: 'Chat thường', exact: true }).click();
  await expect(warning).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(prompt).toHaveValue('Tổng hợp workbook');
  await expect(picker).toHaveCount(0);
  await expect(workbook).toBeVisible();
  const submitted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/conversations\/[^/]+\/messages$/.test(new URL(response.url()).pathname),
  );
  await send.click();
  const response = await submitted;
  expect(response.ok()).toBe(true);
  const body = response.request().postDataJSON();
  expect(body).toEqual({
    content: 'Tổng hợp workbook',
    attachment_ids: [expect.any(String)],
    auto_skill: true,
  });
  const { message } = await response.json();
  expect(message.attachments).toMatchObject([
    { id: body.attachment_ids[0], name: 'research-sales.xlsx' },
  ]);
  await expect(picker).toHaveCount(0);
});
