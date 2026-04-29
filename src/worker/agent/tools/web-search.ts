import { tool } from "ai";
import { z } from "zod";

const EXA_ENDPOINT = "https://api.exa.ai/search";

const inputSchema = z.object({
  query: z.string().describe("The search query."),
  numResults: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("How many results to return. Defaults to 6."),
  category: z
    .enum([
      "company",
      "research paper",
      "news",
      "pdf",
      "github",
      "tweet",
      "personal site",
      "linkedin profile",
      "financial report",
    ])
    .optional()
    .describe("Restrict results to a category when useful."),
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

const ExaResponseSchema = z.object({
  results: z.array(ExaResultSchema).optional(),
});

export function createWebSearchTool(apiKey: string) {
  return tool({
    description: `Search the open web via Exa. Returns titles, URLs, publication dates, a short summary, and a text excerpt for each result. Use this to find sources before scraping, citing, or writing a memo.

Tips:
- For multi-query work (a search per topic, a search per company), call this from inside an \`execute\` snippet with \`Promise.all\` so the searches run in parallel — don't issue them one at a time across turns.
- The default \`numResults: 6\` is right for "find me a few sources." Bump to 12-20 only when you need recall (scanning a landscape, surveying a category). Higher numbers cost more tokens to read back.
- Use \`category\` when you actually want a narrow type (\`research paper\`, \`github\`, \`linkedin profile\`). Leave it off when you'd rather see a mix.
- Search results are *pointers*. The \`summary\` and \`excerpt\` are starting context, not citations. If you're going to assert a fact from a result, follow up with \`web_scrape\` on the URL and quote what you actually read — don't cite from the summary.`,
    inputSchema,
    execute: async ({ query, numResults, category }) => {
      if (!apiKey) {
        return {
          error:
            "EXA_API_KEY is not set. Ask the user to add it via `wrangler secret put EXA_API_KEY` or their Cloudflare dashboard.",
          results: [],
        };
      }
      const body: Record<string, unknown> = {
        query,
        numResults: numResults ?? 6,
        type: "auto",
        contents: {
          text: { maxCharacters: 1200 },
          summary: {},
        },
      };
      if (category) body.category = category;

      const res = await fetch(EXA_ENDPOINT, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const detail = await res.text();
        return {
          error: `Exa request failed (${String(res.status)}): ${detail.slice(0, 500)}`,
          results: [],
        };
      }

      const parsed = ExaResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        return {
          error: `Exa returned an unexpected payload shape: ${parsed.error.message}`,
          results: [],
        };
      }

      const results = (parsed.data.results ?? []).map((r) => ({
        url: r.url ?? "",
        title: r.title ?? "",
        author: r.author ?? null,
        publishedDate: r.publishedDate ?? null,
        summary: r.summary ?? null,
        excerpt: (r.text ?? "").slice(0, 1200),
      }));
      return { results };
    },
  });
}
