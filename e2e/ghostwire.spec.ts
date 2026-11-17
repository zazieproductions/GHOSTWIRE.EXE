import { expect, test } from '@playwright/test';

test.describe('GHOSTWIRE.EXE End-to-End Verification', () => {
  test('works completely in synthetic mode without microphone permission and makes zero external network requests', async ({
    page,
  }) => {
    const externalRequests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (!url.startsWith('http://127.0.0.1') && !url.startsWith('blob:') && !url.startsWith('data:')) {
        externalRequests.push(url);
      }
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'GHOSTWIRE.EXE' })).toBeVisible();
    await expect(page.getByText('IDLE // NO CAPTURE')).toBeVisible();

    // Navigate to Synthetic Signals without granting microphone permission
    await page.getByRole('button', { name: 'SYNTHETIC SIGNALS' }).click();
    await page.getByRole('button', { name: /Electrical Hum/i }).click();

    await expect(page.getByText('SYNTHETIC SIGNAL ACTIVE')).toBeVisible();
    await expect(page.getByText('PASS').first()).toBeVisible();

    // Navigate to Live Monitor and verify live measurements update
    await page.getByRole('button', { name: 'LIVE MONITOR' }).click();
    await expect(page.getByText(/ACTIVE|QUIET/).first()).toBeVisible();

    // Verify Exposure Lab Experiments A..E render and compute
    await page.getByRole('button', { name: 'EXPOSURE LAB' }).click();
    await page.getByRole('button', { name: /CAPTURE WINDOW A/i }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /FINISH WINDOW A/i }).click();
    await expect(page.getByText(/Noise Floor \(10th pct\):/i).first()).toBeVisible();

    await page.getByRole('button', { name: /EXP B/i }).click();
    await expect(page.getByText(/Sustained Tonal Activity/i)).toBeVisible();

    await page.getByRole('button', { name: /EXP C/i }).click();
    await expect(page.getByText(/REQUESTED CONSTRAINTS VS ACTUAL/i)).toBeVisible();

    await page.getByRole('button', { name: /EXP D/i }).click();
    await page.getByLabel(/ENABLE TRANSFORMATION PIPELINE/i).check();
    await expect(page.getByText(/REAL-TIME FEATURE DELTA/i)).toBeVisible();

    await page.getByRole('button', { name: /EXP E/i }).click();
    await expect(page.getByText(/EDUCATIONAL HEURISTIC INDEX/i)).toBeVisible();

    // Session recording and reload reset
    await page.getByRole('button', { name: 'SESSION ANALYSIS' }).click();
    await page.getByRole('button', { name: 'START SESSION' }).click();
    await page.waitForTimeout(450);
    await page.getByRole('button', { name: /STOP & SAVE SESSION/i }).click();
    await expect(page.getByText('RECORDED FEATURE SESSIONS (1)')).toBeVisible();

    // Reload should clear non-persisted session data
    await page.reload();
    await page.getByRole('button', { name: 'SESSION ANALYSIS' }).click();
    await expect(page.getByText('RECORDED FEATURE SESSIONS (0)')).toBeVisible();

    expect(externalRequests).toEqual([]);
  });
});
