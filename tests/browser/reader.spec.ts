import { test, expect } from "@playwright/test";
test("dashboard, upload, original PDF interaction and anonymous timed access", async ({
  page,
  browser,
  browserName,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page).toHaveTitle("SOE Reader");
  await page.getByRole("button", { name: "Open demo workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Your assessments" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "+ New assessment" }).click();
  await page
    .getByLabel("Assessment PDF", { exact: true })
    .setInputFiles("fixtures/assessment.pdf");
  const title = `Browser assessment ${browserName} ${Date.now()}`;
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Upload & prepare speech" }).click();
  const row = page
    .getByRole("button")
    .filter({ has: page.getByText(title, { exact: true }) });
  await expect(row).toContainText("Ready", { timeout: 45000 });
  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Open teacher preview" }).click();
  const preview = await previewPromise;
  await expect(preview.locator(".pdf-page > canvas")).toBeVisible();
  await preview
    .getByRole("button", { name: /Read: 1\. Dr\. Rivera/ })
    .first()
    .click();
  await expect(preview.locator(".speech-region.active").first()).toBeVisible();
  await expect(preview.locator(".reader-status")).toContainText("Reading:");
  await preview.getByRole("button", { name: "Pause speech" }).click();
  await expect(
    preview.getByRole("button", { name: "Play speech" }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Zoom in", exact: true }).click();
  await preview.getByRole("button", { name: "Rotate page clockwise" }).click();
  await expect(preview.locator(".pdf-page > canvas")).toBeVisible();
  await preview
    .getByRole("combobox", { name: "Playback speed" })
    .selectOption("1.5");
  await expect(
    preview.getByRole("combobox", { name: "Playback speed" }),
  ).toHaveValue("1.5");
  await preview.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(preview.locator(".speech-region.active")).toHaveCount(0);
  await preview.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(preview.getByText("Page 2 / 2")).toBeVisible();
  const share = await page.getByLabel("Student share link").inputValue();
  const anon = await browser.newContext();
  const reader = await anon.newPage();
  await reader.goto(share);
  await expect(reader.locator(".pdf-page > canvas")).toBeVisible();
  await expect(reader).not.toHaveURL(/#/);
  await reader.getByRole("button", { name: /Read: A\. The radius/ }).click();
  await reader.getByRole("button", { name: /Read: B\. The radius/ }).click();
  await expect(reader.locator(".reader-status")).toContainText("B. The radius");
  await reader.reload();
  await expect(reader.locator(".pdf-page > canvas")).toBeVisible();
  const docId = new URL(reader.url()).searchParams.get("document")!;
  const badRange = await anon.request.get(`/api/reader/${docId}/pdf`, {
    headers: { Range: "bytes=999999999-" },
  });
  expect(badRange.status()).toBe(416);
  await page.getByRole("button", { name: "Disable now", exact: true }).click();
  await expect(reader.locator(".pdf-page > canvas")).toHaveCount(0, {
    timeout: 12000,
  });
  await expect(reader.getByRole("heading")).toContainText("unavailable");
  const second = await browser.newContext(),
    secondPage = await second.newPage();
  await secondPage.goto("/");
  await secondPage
    .getByRole("button", { name: "Use second demo account" })
    .click();
  await expect(secondPage.getByText(title, { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Your assessments" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Runtime Error");
  expect(errors).toEqual([]);
  expect(
    (
      await page.request.delete(`/api/documents/${docId}`, {
        headers: { Origin: "http://127.0.0.1:3000" },
      })
    ).status(),
  ).toBe(200);
  await anon.close();
  await second.close();
  await preview.close();
});
