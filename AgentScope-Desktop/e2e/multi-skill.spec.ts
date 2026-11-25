import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const run = Date.now().toString(36);
const TOPICS = [
  'pivot',
  'currency',
  'forecast',
  'regional',
  'inventory',
  'payroll',
  'returns',
  'margins',
  'seasonal',
  'cohort',
];
const name = (n: number) => `ms${run}-skill-${String(n).padStart(2, '0')}`;
const skillFile = (skill: string, topic: string) => ({
  name: 'SKILL.md',
  mimeType: 'text/markdown',
  buffer: Buffer.from(
    `---\nname: ${skill}\ndescription: Guidance about ${topic} analysis in spreadsheets.\n---\n# ${skill}\n\nUnique marker ${skill}-${topic}.\n`,
  ),
});
const shots = path.resolve('artifacts/multi-skill-20261123/screens');

async function connect(page: Page) {
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
}

const activeCount = async (page: Page) =>
  Number(
    /(\d+) Skills đang bật$/.exec(
      (await page.locator('.skill-manager-trigger').textContent())?.trim() ?? '',
    )?.[1],
  );

test('ten Skills are managed independently, survive a reload and stay separate from quarantine', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1480, height: 960 });
  await connect(page);
  const nav = page.locator('nav');
  await nav.getByRole('button', { name: /^Skills/ }).click();
  const input = page.locator('input[type=file][accept=".md,.zip"]');
  const before = await page.locator('.skill-card').count();
  for (const [index, topic] of TOPICS.entries())
    await input.setInputFiles(skillFile(name(index + 1), topic));
  // Two Skills with the same display name but different content are separate installations.
  const twin = `ms${run}-twin`;
  await input.setInputFiles(skillFile(twin, 'pivot'));
  await input.setInputFiles(skillFile(twin, 'currency'));
  await input.setInputFiles({
    name: 'SKILL.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      `---\nname: ms${run}-flagged\ndescription: Quarantined fixture.\n---\n\`\`\`python\nkeyboard.Listener(\n`,
    ),
  });
  const card = (skill: string) => page.locator('.skill-card').filter({ hasText: skill });
  await expect(page.locator('.skill-card')).toHaveCount(before + 13);

  // 1-2. Every approved Skill is enabled by default; the quarantined one is not.
  for (let n = 1; n <= 10; n++) {
    await expect(card(name(n)).getByText('Đang bật', { exact: true })).toBeVisible();
    await expect(card(name(n)).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  }
  await expect(card(`ms${run}-flagged`).getByText('Cách ly', { exact: true })).toBeVisible();
  await expect(card(`ms${run}-flagged`).getByRole('switch')).toBeDisabled();
  await expect(card(twin)).toHaveCount(2);
  const baseline = await (async () => {
    await nav.getByRole('button', { name: 'Chat', exact: true }).click();
    return activeCount(page);
  })();
  expect(baseline).toBeGreaterThanOrEqual(12);
  await page.getByRole('button', { name: /Skills đang bật$/ }).click();
  const manager = page.getByRole('dialog', { name: 'Quản lý Skill' });
  await expect(manager.locator('li').filter({ hasText: name(1) })).toContainText('Đang bật');
  await expect(manager.locator('li').filter({ hasText: `ms${run}-flagged` })).toContainText(
    'Cách ly',
  );
  await page.screenshot({ path: path.join(shots, 'manager-1480.png') });
  await page.getByRole('button', { name: /Skills đang bật$/ }).click();

  // 3. Disable #3 from the Skills page; the other nine stay enabled.
  await nav.getByRole('button', { name: /^Skills/ }).click();
  await card(name(3))
    .getByRole('switch', { name: new RegExp(`^Tắt Skill ${name(3)}`) })
    .click();
  await expect(card(name(3)).getByText('Đã tắt bởi bạn', { exact: true })).toBeVisible();
  for (const n of [1, 2, 4, 5, 6, 7, 8, 9, 10])
    await expect(card(name(n)).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await nav.getByRole('button', { name: 'Chat', exact: true }).click();
  expect(await activeCount(page)).toBe(baseline - 1);

  // 8. One of the twins can be switched without touching the other.
  await nav.getByRole('button', { name: /^Skills/ }).click();
  const twins = card(twin);
  await twins.nth(0).getByRole('switch').click();
  await expect(twins.nth(0).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expect(twins.nth(1).getByRole('switch')).toHaveAttribute('aria-checked', 'true');

  // 4. Re-enable #3 with no reinstall (same card, same hash).
  const hash = await card(name(3)).locator('code[title]').last().getAttribute('title');
  await card(name(3))
    .getByRole('switch', { name: new RegExp(`^Bật Skill ${name(3)}`) })
    .click();
  await expect(card(name(3)).getByText('Đang bật', { exact: true })).toBeVisible();
  await expect(card(name(3))).toHaveCount(1);
  expect(await card(name(3)).locator('code[title]').last().getAttribute('title')).toBe(hash);

  // 5-6. Delete #5 only; disabled twin and everything else keep their state.
  await card(name(5)).getByRole('button', { name: 'Gỡ Skill' }).click();
  await page
    .getByRole('dialog', { name: 'Gỡ Skill' })
    .getByRole('button', { name: 'Xác nhận gỡ Skill' })
    .click();
  await expect(card(name(5))).toHaveCount(0);
  await expect(page.locator('.skill-card')).toHaveCount(before + 12);
  for (const n of [1, 2, 3, 4, 6, 7, 8, 9, 10])
    await expect(card(name(n)).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await expect(twins.nth(0).getByRole('switch')).toHaveAttribute('aria-checked', 'false');

  // 7. A full reload re-reads everything from the backend's persisted state.
  await page.reload();
  await connect(page);
  await nav.getByRole('button', { name: /^Skills/ }).click();
  await expect(page.locator('.skill-card')).toHaveCount(before + 12);
  await expect(card(name(5))).toHaveCount(0);
  for (const n of [1, 2, 3, 4, 6, 7, 8, 9, 10])
    await expect(card(name(n)).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  const states = await twins.evaluateAll((nodes) =>
    nodes.map((node) => node.querySelector('[role=switch]')?.getAttribute('aria-checked')).sort(),
  );
  expect(states).toEqual(['false', 'true']);
  await expect(card(`ms${run}-flagged`).getByText('Cách ly', { exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Chat', exact: true }).click();
  expect(await activeCount(page)).toBe(baseline - 2);

  // The compact manager keeps its alignment at a narrow width.
  await page.setViewportSize({ width: 1080, height: 900 });
  await page.getByRole('button', { name: /Skills đang bật$/ }).click();
  const panel = page.getByRole('dialog', { name: 'Quản lý Skill' });
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  const composer = await page.locator('.composer').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(composer!.x - 1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(composer!.x + composer!.width + 1);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  await expect
    .poll(() => page.locator('.composer').evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeLessThanOrEqual(1);
  await page.screenshot({ path: path.join(shots, 'manager-1080.png') });
});
