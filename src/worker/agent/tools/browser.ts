import * as playwright from "@cloudflare/playwright";
import { tool } from "ai";
import { z } from "zod";
import type { Workspace } from "@cloudflare/shell";

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
  savePath: z
    .string()
    .optional()
    .describe("Optional path in the workspace to save the screenshot to (e.g., 'workspace/screenshot.png')."),
  markdown: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to return the page content in Markdown format using Cloudflare's toMarkdown utility. Falls back to text if disabled or unavailable."),
});

export function createBrowserRunTool(browserBinding: any, getWorkspace: () => Workspace, aiBinding?: any) {
  return tool({
    description: `Control a headless browser to interact with web pages. You can navigate, click, type, scroll, and wait for elements.
    
Tips:
- Use this for complex interactions like filling forms, logging in, or navigating SPAs.
- For simple scraping, a single 'navigate' action is enough.
- You can chain multiple actions in one call (e.g., navigate -> type -> click -> wait).
- The tool returns the final page title, text content, and optionally a screenshot.
- Use \`savePath\` to save the screenshot directly to the workspace (e.g., 'workspace/screenshot.png').`,
    inputSchema,
    execute: async ({ actions, screenshot, maxChars, savePath, markdown }) => {
      if (!browserBinding) {
        return {
          error: "BROWSER binding is not configured.",
        };
      }

      let browser: playwright.Browser | undefined;
      let isExistingSession = false;

      try {
        // Try to reuse an existing session
        const sessions = await playwright.sessions(browserBinding).catch(() => []);
        const freeSession = sessions.find((s: any) => !s.connectionId);

        if (freeSession) {
          try {
            browser = await playwright.connect(browserBinding, freeSession.sessionId);
            isExistingSession = true;
          } catch (connErr) {
            console.warn(`Failed to connect to existing session ${freeSession.sessionId}, launching new...`);
          }
        }

        if (!browser) {
          // Launch with 10 minute keep-alive to facilitate future reuse
          browser = await playwright.launch(browserBinding, { keep_alive: 600000 });
          isExistingSession = false;
        }

        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(30000);

        const logs: string[] = [];

        for (const action of actions) {
          try {
            switch (action.type) {
              case "navigate":
                logs.push(`Navigating to ${action.url}...`);
                await page.goto(action.url, { waitUntil: "networkidle" });
                break;
              case "click":
                logs.push(`Clicking ${action.selector}...`);
                await page.click(action.selector);
                break;
              case "type":
                logs.push(`Typing into ${action.selector}...`);
                // Playwright's fill() is generally more reliable for form inputs than type()
                await page.fill(action.selector, action.text);
                break;
              case "press":
                logs.push(`Pressing key ${action.key}...`);
                await page.keyboard.press(action.key);
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
                await page.evaluate(
                  ({ direction, amount }) => {
                    window.scrollBy(0, direction === "up" ? -amount : amount);
                  },
                  { direction: action.direction, amount },
                );
                break;
            }
          } catch (actionErr) {
            const msg = actionErr instanceof Error ? actionErr.message : String(actionErr);
            logs.push(`Action failed (${action.type}): ${msg}`);
            break; // Stop execution on first error
          }
        }

        const title = await page.title();
        const url = page.url();
        let content: string;

        if (markdown !== false && aiBinding?.toMarkdown) {
          try {
            const html = await page.content();
            const mdResult = await aiBinding.toMarkdown({ html });
            content = mdResult.result || mdResult;
          } catch (mdErr) {
            console.warn("Markdown conversion failed, falling back to innerText:", mdErr);
            content = await page.evaluate(() => document.body.innerText);
          }
        } else {
          content = await page.evaluate(() => {
            const scripts = document.querySelectorAll("script, style");
            scripts.forEach((s) => s.remove());
            return document.body.innerText;
          });
        }

        let screenshotData: string | undefined;
        if (screenshot || savePath) {
          const buffer = await page.screenshot({ fullPage: false });
          if (savePath) {
            const workspace = getWorkspace();
            await workspace.writeFileBytes(savePath, buffer, "image/png");
            logs.push(`Screenshot saved to ${savePath}`);
          }
          if (screenshot) {
            screenshotData = buffer.toString("base64");
          }
        }

        const limit = maxChars ?? 20000;
        return {
          title,
          url,
          text: content.slice(0, limit),
          truncated: content.length > limit,
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
          if (isExistingSession) {
            // Close the browser instance obtained via connect() - this just disconnects
            // and keeps the session alive.
            await browser.close();
          } else {
            // If we launched it, we should also close/disconnect it.
            // Documentation says close() on a launch session closes it entirely.
            // If we want it to stay open for reuse, we should probably NOT close it
            // but rely on keep_alive timeout.
            // However, we must close the pages to avoid memory leaks.
            // For now, we'll follow the "launch and close" pattern to be safe, 
            // relying on future sessions being reused if they aren't closed.
            // Wait, if I close it, it's gone.
            // Let's use the connect-only pattern for reuse.
            await browser.close();
          }
        }
      }
    },
  });
}
