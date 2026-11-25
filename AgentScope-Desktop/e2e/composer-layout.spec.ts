import { expect, test } from '@playwright/test';

test('keeps the composer and advanced options inside a narrow chat column', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 900 });
  await page.goto('/');
  const composer = page.locator('.composer');
  const send = composer.locator('.send-button');
  for (const name of [
    'Chat thường',
    'Unprotected Model Test',
    'Protected Test',
    'So sánh cả hai',
  ]) {
    await composer.getByRole('radio', { name, exact: true }).click();
    await expect(send).toBeVisible();
    await expect
      .poll(() => composer.evaluate((el) => el.scrollWidth - el.clientWidth))
      .toBeLessThanOrEqual(1);
  }

  await composer.getByRole('radio', { name: 'Unprotected Model Test' }).click();
  await composer.getByRole('button', { name: 'Tùy chọn nâng cao' }).click();
  await expect(composer.getByText(/SkillGuard OFF gửi nguyên văn/)).toBeVisible();
  const clipped = await composer.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll('.research-advanced select')].some((select) => {
      const area = select.getBoundingClientRect();
      return area.left < bounds.left || area.right > bounds.right;
    });
  });
  expect(clipped).toBe(false);
  await expect(send).toBeVisible();
});
