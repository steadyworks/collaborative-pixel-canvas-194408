import { test, expect, type Page } from '@playwright/test'

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

// Computed CSS background-color values for each test color
const COLORS = {
  red:   'rgb(229, 0, 0)',
  green: 'rgb(2, 190, 1)',
  blue:  'rgb(0, 0, 234)',
} as const

/** Returns the computed background-color of a data-testid element */
async function getBgColor(page: Page, testId: string): Promise<string> {
  return page.getByTestId(testId).evaluate(
    (el) => window.getComputedStyle(el).backgroundColor,
  )
}

/** Waits for the cooldown-timer to disappear (up to 8 s). */
async function waitForCooldown(page: Page): Promise<void> {
  await expect(page.getByTestId('cooldown-timer')).not.toBeVisible({
    timeout: 8_000,
  })
}

test.describe.serial('Collaborative Pixel Canvas', () => {

  // ---------------------------------------------------------------------------
  // TC-01: Real-time pixel sync and tooltip between two clients
  // ---------------------------------------------------------------------------
  test('TC-01: pixel placed by one client syncs to second client with correct tooltip', async ({ browser }) => {
    test.setTimeout(30_000)

    const ctxA = await browser.newContext()
    const ctxB = await browser.newContext()
    const pageA = await ctxA.newPage()
    const pageB = await ctxB.newPage()

    try {
      await Promise.all([
        pageA.goto(BASE, { waitUntil: 'networkidle' }),
        pageB.goto(BASE, { waitUntil: 'networkidle' }),
      ])

      // Read the auto-generated display name on Client A
      const nameA = (await pageA.getByTestId('user-identifier').textContent()) ?? ''
      expect(nameA.trim()).not.toBe('')

      // Client A: select red and click pixel-5-5
      await pageA.getByTestId('color-swatch-e50000').click()
      await pageA.getByTestId('pixel-5-5').click()

      // Client B: wait for the pixel to turn red without reloading
      await expect(pageB.getByTestId('pixel-5-5')).toHaveCSS(
        'background-color',
        COLORS.red,
        { timeout: 10_000 },
      )

      // Client B: hover and verify tooltip
      await pageB.getByTestId('pixel-5-5').hover()
      await expect(pageB.getByTestId('pixel-tooltip')).toBeVisible({ timeout: 5_000 })
      await expect(pageB.getByTestId('tooltip-user')).toHaveText(nameA.trim())
      const timestampText = await pageB.getByTestId('tooltip-timestamp').textContent()
      expect(timestampText?.trim()).toBeTruthy()
    } finally {
      await ctxA.close()
      await ctxB.close()
    }
  })

  // ---------------------------------------------------------------------------
  // TC-02: Cooldown prevents immediate second placement
  // ---------------------------------------------------------------------------
  test('TC-02: cooldown timer appears and blocks a second pixel placement', async ({ page }) => {
    test.setTimeout(40_000)
    await page.goto(BASE, { waitUntil: 'networkidle' })

    // Pre-paint pixel-35-35 with blue so we know its exact color going in
    await page.getByTestId('color-swatch-0000ea').click()
    await page.getByTestId('pixel-35-35').click()
    await expect(page.getByTestId('pixel-35-35')).toHaveCSS('background-color', COLORS.blue)
    await waitForCooldown(page)

    // Switch to red and place pixel-34-34 → cooldown starts
    await page.getByTestId('color-swatch-e50000').click()
    await page.getByTestId('pixel-34-34').click()

    // Immediately try to paint pixel-35-35 – must be silently ignored
    await page.getByTestId('pixel-35-35').click()

    // pixel-35-35 stays blue (not red)
    await expect(page.getByTestId('pixel-35-35')).toHaveCSS('background-color', COLORS.blue)

    // Cooldown timer should be visible showing 1–5
    const timer = page.getByTestId('cooldown-timer')
    await expect(timer).toBeVisible({ timeout: 1_000 })
    const timerText = await timer.textContent()
    const timerValue = parseInt(timerText ?? '0', 10)
    expect(timerValue).toBeGreaterThanOrEqual(1)
    expect(timerValue).toBeLessThanOrEqual(5)

    // Wait for cooldown to clear
    await waitForCooldown(page)

    // Now place pixel-35-35 – must succeed
    await page.getByTestId('pixel-35-35').click()
    await expect(page.getByTestId('pixel-35-35')).toHaveCSS(
      'background-color',
      COLORS.red,
      { timeout: 3_000 },
    )
  })

  // ---------------------------------------------------------------------------
  // TC-03: Color palette selection controls placed pixel color
  // ---------------------------------------------------------------------------
  test('TC-03: selecting a color swatch updates the indicator and paints pixels in that color', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto(BASE, { waitUntil: 'networkidle' })

    // Red
    await page.getByTestId('color-swatch-e50000').click()
    await expect(page.getByTestId('selected-color-display')).toHaveAttribute('data-color', '#E50000')
    await page.getByTestId('pixel-20-20').click()
    await expect(page.getByTestId('pixel-20-20')).toHaveCSS('background-color', COLORS.red)
    await waitForCooldown(page)

    // Green
    await page.getByTestId('color-swatch-02be01').click()
    await expect(page.getByTestId('selected-color-display')).toHaveAttribute('data-color', '#02BE01')
    await page.getByTestId('pixel-21-21').click()
    await expect(page.getByTestId('pixel-21-21')).toHaveCSS('background-color', COLORS.green)
    await waitForCooldown(page)

    // Blue
    await page.getByTestId('color-swatch-0000ea').click()
    await expect(page.getByTestId('selected-color-display')).toHaveAttribute('data-color', '#0000EA')
    await page.getByTestId('pixel-22-22').click()
    await expect(page.getByTestId('pixel-22-22')).toHaveCSS('background-color', COLORS.blue)
  })

  // ---------------------------------------------------------------------------
  // TC-04: Timelapse replays history in chronological order
  // ---------------------------------------------------------------------------
  test('TC-04: timelapse starts from blank, preserves order, is non-interactive, stop restores live state', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto(BASE, { waitUntil: 'networkidle' })

    // Place three pixels in order, waiting for cooldown between each
    await page.getByTestId('color-swatch-e50000').click()
    await page.getByTestId('pixel-30-30').click()
    await expect(page.getByTestId('pixel-30-30')).toHaveCSS('background-color', COLORS.red)
    await waitForCooldown(page)

    await page.getByTestId('color-swatch-02be01').click()
    await page.getByTestId('pixel-31-31').click()
    await expect(page.getByTestId('pixel-31-31')).toHaveCSS('background-color', COLORS.green)
    await waitForCooldown(page)

    await page.getByTestId('color-swatch-0000ea').click()
    await page.getByTestId('pixel-32-32').click()
    await expect(page.getByTestId('pixel-32-32')).toHaveCSS('background-color', COLORS.blue)
    await waitForCooldown(page)  // wait so cooldown is not a confounding factor below

    // ---------- start timelapse ----------
    await page.getByTestId('timelapse-btn').click()

    // timelapse-stop must appear
    await expect(page.getByTestId('timelapse-stop')).toBeVisible({ timeout: 5_000 })

    // Canvas starts from blank: the last cell placed must NOT be blue immediately
    await expect(page.getByTestId('pixel-32-32')).not.toHaveCSS('background-color', COLORS.blue)

    // Non-interactivity: clicking a cell must not trigger the cooldown timer
    // (the cooldown timer only starts when a placement succeeds)
    await page.getByTestId('pixel-33-33').click()
    await page.waitForTimeout(300)  // give the UI a moment to react
    await expect(page.getByTestId('cooldown-timer')).not.toBeVisible()

    // Ordering: the replay runs in chronological order.
    // pixel-30-30 (red) was placed before pixel-32-32 (blue) in this test run,
    // so when pixel-32-32 finally turns blue in the replay, pixel-30-30 must
    // already be red (it was applied at an earlier replay step).
    // Timeout allows the timelapse to progress through the full history.
    await expect(page.getByTestId('pixel-32-32')).toHaveCSS(
      'background-color',
      COLORS.blue,
      { timeout: 30_000 },
    )
    // pixel-30-30 must already have been replayed at this point
    await expect(page.getByTestId('pixel-30-30')).toHaveCSS('background-color', COLORS.red)

    // ---------- stop timelapse ----------
    const stopBtn = page.getByTestId('timelapse-stop')
    if (await stopBtn.isVisible()) {
      await stopBtn.click()
    }

    await expect(page.getByTestId('timelapse-stop')).not.toBeVisible({ timeout: 5_000 })

    // Live state must be fully restored
    await expect(page.getByTestId('pixel-30-30')).toHaveCSS('background-color', COLORS.red, { timeout: 5_000 })
    await expect(page.getByTestId('pixel-31-31')).toHaveCSS('background-color', COLORS.green, { timeout: 5_000 })
    await expect(page.getByTestId('pixel-32-32')).toHaveCSS('background-color', COLORS.blue, { timeout: 5_000 })
  })

  // ---------------------------------------------------------------------------
  // TC-05: Canvas state persists across page reload
  // ---------------------------------------------------------------------------
  test('TC-05: pixel placements survive a full page reload', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto(BASE, { waitUntil: 'networkidle' })

    // Place three pixels at unique positions
    await page.getByTestId('color-swatch-e50000').click()
    await page.getByTestId('pixel-50-50').click()
    await expect(page.getByTestId('pixel-50-50')).toHaveCSS('background-color', COLORS.red)
    await waitForCooldown(page)

    await page.getByTestId('color-swatch-02be01').click()
    await page.getByTestId('pixel-51-51').click()
    await expect(page.getByTestId('pixel-51-51')).toHaveCSS('background-color', COLORS.green)
    await waitForCooldown(page)

    await page.getByTestId('color-swatch-0000ea').click()
    await page.getByTestId('pixel-52-52').click()
    await expect(page.getByTestId('pixel-52-52')).toHaveCSS('background-color', COLORS.blue)

    // Brief pause to ensure the last write has been persisted by the backend
    await page.waitForTimeout(500)

    // Hard reload – must fetch fresh canvas state from the backend
    await page.reload({ waitUntil: 'networkidle' })

    await expect(page.getByTestId('pixel-50-50')).toHaveCSS(
      'background-color', COLORS.red,   { timeout: 10_000 },
    )
    await expect(page.getByTestId('pixel-51-51')).toHaveCSS(
      'background-color', COLORS.green, { timeout: 10_000 },
    )
    await expect(page.getByTestId('pixel-52-52')).toHaveCSS(
      'background-color', COLORS.blue,  { timeout: 10_000 },
    )
  })
})
