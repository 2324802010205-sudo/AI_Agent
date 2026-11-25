import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

test('answer evaluation computes real workbook ground truth without calling Gemini', async ({
  page,
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
  await page.getByRole('tab', { name: /Đánh giá PI/ }).click();
  await page
    .getByLabel('Workbook đánh giá', { exact: true })
    .setInputFiles('e2e/fixtures/research-sales.xlsx');
  const prepare = page.getByRole('button', { name: 'Tính ground truth · lưu kế hoạch' });
  await expect(prepare).toBeEnabled();
  await prepare.click();
  await expect(page.getByText(/48 đơn · doanh thu 344.740.000 VND/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Chạy control Gemini thật · không Skill' }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Injection Skill · đang khóa' })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Kiểm tra containment và arithmetic đã duyệt' }),
  ).toBeDisabled();
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Xuất raw answer và bằng chứng' }).click();
  await (await exported).saveAs(testInfo.outputPath('evaluation-prepared-evidence.zip'));
  await page.screenshot({
    path: testInfo.outputPath('answer-evaluation-prepared.png'),
    fullPage: true,
    animations: 'disabled',
  });
});
