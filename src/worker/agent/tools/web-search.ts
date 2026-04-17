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
    description:
      "Search the open web via Exa. Returns titles, URLs, publication dates, a short summary, and a text excerpt for each result. Use this to find sources before scraping or writing a memo.",
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
