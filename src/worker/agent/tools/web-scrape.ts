import { tool } from "ai";
import { z } from "zod";
import { launch } from "@cloudflare/puppeteer";

const inputSchema = z.object({
  url: z.string().url().describe("The URL to fetch."),
  render: z
    .boolean()
    .optional()
    .describe(
      "If true, uses a headless browser (for JS-rendered pages). Defaults to false — prefers plain fetch, which is faster and cheaper.",
    ),
  maxChars: z
    .number()
    .int()
    .min(500)
    .max(50000)
    .optional()
    .describe(
      "Maximum characters of extracted text to return. Defaults to 12000.",
    ),
});

function extractTextFromHtml(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const withoutTags = withoutScripts.replace(/<[^>]+>/g, " ");
  return withoutTags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function scrapeWithFetch(
  url: string,
): Promise<{ title: string; text: string; status: number }> {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; DownyBot/1.0; +https://github.com/cloudflare/agents)",
      accept: "text/html,application/xhtml+xml",
    },
  });
  const html = await res.text();
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch?.[1]?.trim() ?? "";
  return { title, text: extractTextFromHtml(html), status: res.status };
}

async function scrapeWithBrowser(
  browser: Fetcher,
  url: string,
): Promise<{ title: string; text: string; status: number }> {
  const session = await launch(browser);
  try {
    const page = await session.newPage();
    const response = await page.goto(url, {
      waitUntil: "networkidle0",
      timeout: 20000,
    });
    const title = await page.title();
    const text = await page.evaluate(() => {
      return document.body?.innerText ?? "";
    });
    return { title, text, status: response?.status() ?? 200 };
  } finally {
    await session.close();
  }
}

export function createWebScrapeTool(browser: Fetcher) {
  return tool({
    description: `Fetch a URL and return its main text content. Returns \`{ url, status, title, text, truncated? }\` on success or \`{ url, error, text: "" }\` on failure.

Tips:
- Default is plain HTTP (fast, cheap). Only set \`render: true\` when the page is JS-rendered and the plain fetch comes back with empty or shell-only text — most blogs, docs sites, and news pages do not need rendering.
- For multi-URL work (a scrape per search hit, a scrape per page in a list) call this from inside an \`execute\` snippet with \`Promise.all\` so the scrapes run in parallel. Pair each scrape with \`.catch(e => ({ url, error: String(e) }))\` so one bad URL doesn't tank the rest.
- \`maxChars\` defaults to 12000 (~3k tokens). Bump it for long-form content you need to read in full; lower it when you only need a snippet and want to save tokens.
- A \`status\` of 200 with empty \`text\` usually means the page is JS-rendered — retry with \`render: true\`. A \`status\` of 403/429 means the site is blocking the bot — note that and stop hammering it.
- When the user pastes a URL in chat, scrape it first before answering. The link is almost always the spec for what they're asking.`,
    inputSchema,
    execute: async ({ url, render, maxChars }) => {
      const limit = maxChars ?? 12000;
      try {
        const result = render
          ? await scrapeWithBrowser(browser, url)
          : await scrapeWithFetch(url);
        return {
          url,
          status: result.status,
          title: result.title,
          text: result.text.slice(0, limit),
          truncated: result.text.length > limit,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { url, error: message, text: "" };
      }
    },
  });
}
