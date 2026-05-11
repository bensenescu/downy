import puppeteer from "@cloudflare/puppeteer";
import { tool } from "ai";
import { z } from "zod";

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("navigate"),
    url: z.string().url().describe("The URL to navigate to."),
  }),
  z.object({
    type: z.literal("click"),
    selector: z.string().describe("The CSS selector of the element to click."),
  }),
  z.object({
    type: z.literal("type"),
    selector: z.string().describe("The CSS selector of the element to type into."),
    text: z.string().describe("The text to type."),
  }),
  z.object({
    type: z.literal("press"),
    key: z.string().describe("The key to press (e.g., 'Enter', 'Tab', 'Escape')."),
  }),
  z.object({
    type: z.literal("wait"),
    selector: z.string().optional().describe("Optional CSS selector to wait for."),
    ms: z.number().optional().describe("Optional milliseconds to wait."),
  }),
  z.object({
    type: z.literal("scroll"),
    direction: z.enum(["up", "down"]).describe("The direction to scroll."),
    amount: z.number().optional().describe("The amount to scroll in pixels. Defaults to 500."),
  }),
]);

const inputSchema = z.object({
  actions: z.array(actionSchema).min(1).describe("A sequence of actions to perform in the browser."),
  screenshot: z.boolean().optional().describe("Whether to include a screenshot of the final page state."),
  maxChars: z
    .number()
    .int()
    .min(500)
    .max(100000)
    .optional()
    .describe("Maximum characters of extracted text to return. Defaults to 20000."),
});

export function createBrowserRunTool(browserBinding: any) {
  return tool({
    description: `Control a headless browser to interact with web pages. You can navigate, click, type, scroll, and wait for elements.
    
Tips:
- Use this for complex interactions like filling forms, logging in, or navigating SPAs.
- For simple scraping, a single 'navigate' action is enough.
- You can chain multiple actions in one call (e.g., navigate -> type -> click -> wait).
- The tool returns the final page title, text content, and optionally a screenshot.`,
    inputSchema,
    execute: async ({ actions, screenshot, maxChars }) => {
      if (!browserBinding) {
        return {
          error: "BROWSER binding is not configured.",
        };
      }

      let browser;
      try {
        browser = await puppeteer.launch(browserBinding);
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(30000);

        const logs: string[] = [];

        for (const action of actions) {
          try {
            switch (action.type) {
              case "navigate":
                logs.push(`Navigating to ${action.url}...`);
                await page.goto(action.url, { waitUntil: "networkidle2" });
                break;
              case "click":
                logs.push(`Clicking ${action.selector}...`);
                await page.click(action.selector);
                break;
              case "type":
                logs.push(`Typing into ${action.selector}...`);
                await page.type(action.selector, action.text);
                break;
              case "press":
                logs.push(`Pressing key ${action.key}...`);
                await page.keyboard.press(action.key as any);
                break;
              case "wait":
                if (action.selector) {
                  logs.push(`Waiting for selector ${action.selector}...`);
                  await page.waitForSelector(action.selector, { timeout: 10000 });
                } else if (action.ms) {
                  logs.push(`Waiting for ${action.ms}ms...`);
                  await new Promise((resolve) => setTimeout(resolve, action.ms));
                }
                break;
              case "scroll":
                const amount = action.amount ?? 500;
                logs.push(`Scrolling ${action.direction} by ${amount}px...`);
                await page.evaluate((dir, amt) => {
                  window.scrollBy(0, dir === "up" ? -amt : amt);
                }, action.direction, amount);
                break;
            }
          } catch (actionErr) {
            const msg = actionErr instanceof Error ? actionErr.message : String(actionErr);
            logs.push(`Action failed (${action.type}): ${msg}`);
            break; // Stop execution on first error
          }
        }

        const title = await page.title();
        const text = await page.evaluate(() => {
          const scripts = document.querySelectorAll("script, style");
          scripts.forEach((s) => s.remove());
          return document.body.innerText;
        });

        let screenshotData: string | undefined;
        if (screenshot) {
          const buffer = await page.screenshot({ fullPage: false });
          screenshotData = buffer.toString("base64");
        }

        const limit = maxChars ?? 20000;
        return {
          title,
          url: page.url(),
          text: text.slice(0, limit),
          truncated: text.length > limit,
          logs,
          ...(screenshotData ? { screenshot: `data:image/png;base64,${screenshotData}` } : {}),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          error: `Browser execution failed: ${message}`,
        };
      } finally {
        if (browser) {
          await browser.close();
        }
      }
    },
  });
}
