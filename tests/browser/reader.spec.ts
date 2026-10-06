import { test, expect } from "@playwright/test";
import type { Manifest } from "../../lib/model";
test("teacher tools, continuous pages and document playback stay intuitive and private", async ({
  page,
  browser,
  browserName,
}) => {
  const errors: string[] = [];
  if (browserName === "chromium")
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.context().addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      (window as any).__validationMedia = this;
      return play.call(this);
    };
  });
  await page.goto("/");
  await expect(page).toHaveTitle("Safe Online Exam Reader");
  await expect(
    page.getByText("Original PDFs. Cached speech. Timed access."),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Open demo workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Your assessments" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "+ New assessment" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Opens date")).toHaveAttribute("type", "date");
  await expect(page.getByLabel("Opens time")).toHaveJSProperty(
    "tagName",
    "SELECT",
  );
  await expect(page.getByLabel("Time zone")).toHaveJSProperty(
    "tagName",
    "SELECT",
  );
  await page.getByLabel("Speech voice").selectOption("en-US-Chirp3-HD-Aoede");
  await expect(page.getByText(/Expressive HD/)).toBeVisible();
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop sample", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop sample", exact: true }).click();
  await page
    .getByLabel("Assessment PDF", { exact: true })
    .setInputFiles("fixtures/assessment.pdf");
  const title = `Browser assessment ${browserName} ${Date.now()}`;
  await page.getByLabel("Title", { exact: true }).fill(title);
  const openingDate = await page.getByLabel("Opens date").inputValue();
  const futureDate = new Date(`${openingDate}T12:00:00Z`);
  futureDate.setUTCDate(futureDate.getUTCDate() + 2);
  await page
    .getByLabel("Opens date")
    .fill(futureDate.toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Upload & prepare speech" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.getByLabel("Opens date").fill(openingDate);
  await page.getByRole("button", { name: "Upload & prepare speech" }).click();
  const row = page
    .getByRole("button")
    .filter({ has: page.getByText(title, { exact: true }) });
  await expect(row).toContainText("Available now", { timeout: 45000 });
  const details = page.getByRole("complementary", {
    name: "Assessment details",
  });
  await expect(details.getByRole("button").first()).toHaveAttribute(
    "aria-label",
    "Close assessment details",
  );
  await expect(
    details.getByRole("button", { name: "Copy student link", exact: true }),
  ).toBeVisible();
  await details
    .getByRole("button", { name: "Copy student link", exact: true })
    .click();
  await expect(
    details.getByRole("button", { name: "Link copied", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search assessments" })
    .fill("no matching title");
  await expect(row).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search assessments" }).fill(title);
  await expect(row).toBeVisible();
  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Open teacher preview" }).click();
  const preview = await previewPromise;
  preview.on("pageerror", (e) => errors.push(e.message));
  const docId = new URL(preview.url()).pathname.split("/").pop()!;
  const manifest: Manifest = await (
    await preview.request.get(`/api/reader/${docId}/manifest?preview=1`)
  ).json();
  await expect(preview.locator(".speech-region").first()).toBeVisible();
  await expect(preview.locator(".pdf-sheet")).toHaveCount(2);
  await expect(
    preview.getByRole("button", { name: "Passages", exact: true }),
  ).toHaveCount(0);
  await expect(preview.locator(".reader-status")).toHaveCount(0);
  await preview
    .getByRole("button", { name: "Play speech", exact: true })
    .click();
  await expect(
    preview.getByRole("button", { name: "Pause speech", exact: true }),
  ).toBeVisible();
  await expect(
    preview
      .locator(
        `.speech-region.active[data-segment="${manifest.segments[0].id}"]`,
      )
      .first(),
  ).toBeVisible();
  await preview.evaluate(() => {
    const audio = (window as any).__validationMedia as HTMLAudioElement;
    audio.currentTime = Math.max(0, audio.duration - 0.05);
  });
  await expect(
    preview
      .locator(
        `.speech-region.active[data-segment="${manifest.segments[1].id}"]`,
      )
      .first(),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Pause speech" }).click();
  const paused = await preview.evaluate(
    () => (window as any).__validationMedia.currentTime,
  );
  await preview.waitForTimeout(350);
  expect(
    Math.abs(
      (await preview.evaluate(
        () => (window as any).__validationMedia.currentTime,
      )) - paused,
    ),
  ).toBeLessThan(0.1);
  await preview.getByRole("button", { name: "Play speech" }).click();
  await expect(
    preview.getByRole("button", { name: "Pause speech" }),
  ).toBeVisible();
  await preview
    .getByRole("combobox", { name: "Playback speed" })
    .selectOption("1.5");
  await expect(
    preview.getByRole("combobox", { name: "Playback speed" }),
  ).toHaveValue("1.5");
  await preview.getByRole("button", { name: "Forward 10 seconds" }).click();
  await preview.getByRole("button", { name: "Rewind 10 seconds" }).click();
  await preview.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(preview.locator(".speech-region.active")).toHaveCount(0);
  await expect(
    preview.getByRole("slider", { name: "Reading progress" }),
  ).toHaveValue("0");
  await preview.getByRole("button", { name: "Zoom in", exact: true }).click();
  await preview.getByRole("button", { name: "Rotate page clockwise" }).click();
  await preview.getByRole("button", { name: "Fit to width" }).click();
  await expect(
    preview.getByRole("button", { name: "Fit to width" }),
  ).toHaveAttribute("aria-pressed", "true");
  await preview.getByRole("combobox", { name: "Go to page" }).selectOption("2");
  await expect(
    preview
      .getByRole("region", { name: "Page 2", exact: true })
      .locator("canvas"),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Next speech segment" }).click();
  await expect(
    preview.getByRole("button", { name: "Pause speech" }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Stop", exact: true }).click();
  const share = await page.getByLabel("Student share link").inputValue();
  const anon = await browser.newContext();
  const reader = await anon.newPage();
  reader.on("pageerror", (e) => errors.push(e.message));
  await reader.goto(share);
  await expect(reader.locator(".speech-region").first()).toBeVisible();
  await expect(reader).not.toHaveURL(/#/);
  await reader.getByRole("button", { name: /Read: A\. The radius/ }).click();
  await reader.getByRole("button", { name: /Read: B\. The radius/ }).click();
  const chosen = manifest.segments.find((s) =>
    s.text.startsWith("B. The radius"),
  )!;
  await expect(
    reader.locator(`.speech-region.active[data-segment="${chosen.id}"]`),
  ).toBeVisible();
  await reader.reload();
  await expect(reader.locator(".speech-region").first()).toBeVisible();
  expect(
    (
      await anon.request.get(`/api/reader/${docId}/pdf`, {
        headers: { Range: "bytes=999999999-" },
      })
    ).status(),
  ).toBe(416);
  await reader.setViewportSize({ width: 390, height: 844 });
  await reader.getByRole("button", { name: "Fit to width" }).click();
  expect(
    await reader.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  await expect(
    reader.getByRole("button", { name: "Play speech" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Disable now", exact: true }).click();
  await expect(reader.locator(".pdf-page canvas")).toHaveCount(0, {
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
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
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
