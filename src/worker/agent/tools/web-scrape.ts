import { tool } from "ai";
import { z } from "zod";

const EXA_ENDPOINT = "https://api.exa.ai/contents";

const inputSchema = z.object({
  url: z.string().url().describe("The URL to fetch."),
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

const ExaResultSchema = z.object({
  id: z.string().optional(),
  url: z.string().optional(),
  title: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  publishedDate: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
});

const ExaStatusSchema = z.object({
  id: z.string().optional(),
  status: z.string().optional(),
  error: z
    .union([
      z.string(),
      z.object({ tag: z.string().optional() }).passthrough(),
    ])
    .nullable()
    .optional(),
});

const ExaResponseSchema = z.object({
  results: z.array(ExaResultSchema).optional(),
  statuses: z.array(ExaStatusSchema).optional(),
});

export function createWebScrapeTool(apiKey: string) {
  return tool({
    description: `Fetch a URL via Exa Contents and return its main text content. Returns \`{ url, title, text, summary, publishedDate?, author?, truncated? }\` on success or \`{ url, error, text: "" }\` on failure.

Tips:
- Exa handles JS-rendered pages, paywalls, and bot blocking server-side — there's no \`render\` flag to toggle.
- For multi-URL work (a scrape per search hit, a scrape per page in a list) call this from inside an \`execute\` snippet with \`Promise.all\` so the scrapes run in parallel. Pair each scrape with \`.catch(e => ({ url, error: String(e) }))\` so one bad URL doesn't tank the rest.
- \`maxChars\` defaults to 12000 (~3k tokens). Bump it for long-form content you need to read in full; lower it when you only need a snippet and want to save tokens.
- An \`error\` result means Exa couldn't retrieve that URL — note it and move on rather than retrying the same URL.
- When the user pastes a URL in chat, scrape it first before answering. The link is almost always the spec for what they're asking.`,
    inputSchema,
    execute: async ({ url, maxChars }) => {
      const limit = maxChars ?? 12000;
      if (!apiKey) {
        return {
          url,
          error:
            "EXA_API_KEY is not set. Ask the user to add it via `wrangler secret put EXA_API_KEY` or their Cloudflare dashboard.",
          text: "",
        };
      }

      let res: Response;
      try {
        res = await fetch(EXA_ENDPOINT, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            urls: [url],
            text: { maxCharacters: limit },
            summary: {},
            livecrawlTimeout: 15000,
          }),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { url, error: message, text: "" };
      }

      if (!res.ok) {
        const detail = await res.text();
        return {
          url,
          error: `Exa request failed (${String(res.status)}): ${detail.slice(0, 500)}`,
          text: "",
        };
      }

      const parsed = ExaResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        return {
          url,
          error: `Exa returned an unexpected payload shape: ${parsed.error.message}`,
          text: "",
        };
      }

      const status = parsed.data.statuses?.[0];
      if (status?.status && status.status !== "success") {
        const detail =
          typeof status.error === "string"
            ? status.error
            : status.error?.tag ?? status.status;
        return {
          url,
          error: `Exa could not retrieve the URL: ${detail}`,
          text: "",
        };
      }

      const result = parsed.data.results?.[0];
      if (!result) {
        return {
          url,
          error: "Exa returned no result for the URL.",
          text: "",
        };
      }

      const fullText = result.text ?? "";
      return {
        url: result.url ?? url,
        title: result.title ?? "",
        text: fullText.slice(0, limit),
        summary: result.summary ?? null,
        author: result.author ?? null,
        publishedDate: result.publishedDate ?? null,
        truncated: fullText.length > limit,
      };
    },
  });
}
