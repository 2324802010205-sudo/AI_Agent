import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

test('Research Lab prepares/export evidence but refuses real execution without a VM', async ({
  page,
  request,
}, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cài đặt', exact: true }).click();
  const credential = readFileSync(
    process.env.AGENTSCOPE_SESSION_TOKEN_FILE ||
      path.resolve('../AgentScope-Backend/.agentscope/session-token'),
    'utf8',
  ).trim();
  await page.getByLabel('Mã phiên phát triển').fill(credential);
  await page.getByRole('button', { name: 'Kết nối backend', exact: true }).click();
  await page.getByRole('button', { name: 'Nghiên cứu nâng cao', exact: true }).click();
  await page.getByRole('tab', { name: /Lab nghiên cứu/ }).click();
  await expect(page.getByText('Lab đang khóa · chưa có VM được xác minh')).toBeVisible();
  await page
    .getByLabel('Workbook được phép nghiên cứu (.xlsx)')
    .setInputFiles('e2e/fixtures/research-sales.xlsx');
  await expect(page.getByRole('button', { name: 'Tạo kế hoạch · chưa chạy AI' })).toBeEnabled();
  await page.getByRole('button', { name: 'Tạo kế hoạch · chưa chạy AI' }).click();
  await expect(page.getByText('sales-evaluation · benign-control')).toBeVisible();
  await page.getByRole('checkbox').check();
  await expect(page.getByRole('button', { name: 'Chạy baseline' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Chạy protected' })).toBeDisabled();
  const plans = await (
    await request.get('http://127.0.0.1:8765/api/lab/plans', {
      headers: { Authorization: `Bearer ${credential}` },
    })
  ).json();
  const latest = plans.find((p: { workspace: string }) => p.workspace === 'sales-evaluation');
  const denied = await request.post(`http://127.0.0.1:8765/api/lab/plans/${latest.id}/run`, {
    headers: { Authorization: `Bearer ${credential}` },
    data: { role: 'baseline', disposable_vm_consent: true },
  });
  expect(denied.status()).toBe(403);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Xuất evidence ZIP và báo cáo' }).click();
  const download = await downloadEvent;
  await download.saveAs(testInfo.outputPath('lab-not-run-evidence.zip'));
  await page.screenshot({
    path: testInfo.outputPath('research-lab-locked.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('tab', { name: /Lab PI cô lập/ }).click();
  const lab = page.getByRole('region', { name: 'Isolated Prompt Injection Research Lab' });
  await expect(lab.getByText('Điều kiện chạy thử nghiệm')).toBeVisible();
  await expect
    .poll(() => lab.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1);
});
