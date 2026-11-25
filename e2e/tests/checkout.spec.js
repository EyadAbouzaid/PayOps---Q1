const { test, expect } = require('@playwright/test');

test('E2E Happy Path: browse -> cart -> checkout with 4242424242424242 -> Paid shown', async ({ page }) => {
  await page.goto('/');

  // Register new user
  await page.getByTestId('nav-auth').click();
  await page.getByText('Need an account? Register').click();
  await page.getByTestId('auth-name').fill('E2E Buyer');
  await page.getByTestId('auth-email').fill(`e2e_${Date.now()}@store.io`);
  await page.getByTestId('auth-password').fill('Password123!');
  await page.getByTestId('auth-submit').click();

  // Browse & Add first product to cart
  const firstAddBtn = page.locator('[data-testid^="add-to-cart-"]').first();
  await expect(firstAddBtn).toBeVisible();
  await firstAddBtn.click();

  // Go to Cart -> Checkout
  await page.getByTestId('nav-cart').click();
  await page.getByTestId('proceed-checkout').click();

  // Pay with test Visa 4242424242424242
  await page.getByTestId('card-number').fill('4242424242424242');
  await page.getByTestId('submit-payment').click();

  // Verify "Paid" shown on Order Status page
  const statusLabel = page.getByTestId('order-status-label');
  await expect(statusLabel).toHaveText('Paid', { timeout: 15000 });
});

test('E2E Failed Payment: declined card never marks order Paid', async ({ page }) => {
  await page.goto('/');

  await page.getByTestId('nav-auth').click();
  await page.getByText('Need an account? Register').click();
  await page.getByTestId('auth-name').fill('Declined Buyer');
  await page.getByTestId('auth-email').fill(`e2e_fail_${Date.now()}@store.io`);
  await page.getByTestId('auth-password').fill('Password123!');
  await page.getByTestId('auth-submit').click();

  await page.locator('[data-testid^="add-to-cart-"]').first().click();
  await page.getByTestId('nav-cart').click();
  await page.getByTestId('proceed-checkout').click();

  // Card ending in 0002 triggers deterministic decline in payops-mock
  await page.getByTestId('card-number').fill('4000000000000002');
  await page.getByTestId('submit-payment').click();

  const statusLabel = page.getByTestId('order-status-label');
  await expect(statusLabel).toHaveText('PAYMENT_FAILED', { timeout: 15000 });
  await expect(statusLabel).not.toHaveText('Paid');
});
