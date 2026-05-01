import { tool } from "ai";
import { z } from "zod";

const EXA_ENDPOINT = "https://api.exa.ai/search";

const querySchema = z.object({
  query: z.string().describe("The search query."),
  numResults: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("How many results to return for this query. Defaults to 6."),
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

const inputSchema = z.object({
  queries: z
    .array(querySchema)
    .min(1)
    .max(10)
    .describe(
      "One or more search queries. All queries run in parallel server-side — pass several at once instead of issuing one call per query.",
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

const ExaResponseSchema = z.object({
  results: z.array(ExaResultSchema).optional(),
});

type Hit = {
  url: string;
  title: string;
  author: string | null;
  publishedDate: string | null;
  summary: string | null;
  excerpt: string;
};

type QueryResult =
  | { query: string; hits: Hit[] }
  | { query: string; error: string; hits: [] };

async function runOneQuery(
  apiKey: string,
  q: z.infer<typeof querySchema>,
): Promise<QueryResult> {
  const body: Record<string, unknown> = {
    query: q.query,
    numResults: q.numResults ?? 6,
    type: "auto",
    contents: {
      text: { maxCharacters: 1200 },
      summary: {},
    },
  };
  if (q.category) body.category = q.category;

  let res: Response;
  try {
    res = await fetch(EXA_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { query: q.query, error: message, hits: [] };
  }

  if (!res.ok) {
    const detail = await res.text();
    return {
      query: q.query,
      error: `Exa request failed (${String(res.status)}): ${detail.slice(0, 500)}`,
      hits: [],
    };
  }

  const parsed = ExaResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    return {
      query: q.query,
      error: `Exa returned an unexpected payload shape: ${parsed.error.message}`,
      hits: [],
    };
  }

  const hits = (parsed.data.results ?? []).map((r) => ({
    url: r.url ?? "",
    title: r.title ?? "",
    author: r.author ?? null,
    publishedDate: r.publishedDate ?? null,
    summary: r.summary ?? null,
    excerpt: (r.text ?? "").slice(0, 1200),
  }));
  return { query: q.query, hits };
}

export function createWebSearchTool(apiKey: string) {
  return tool({
    description: `Search the open web via Exa. Accepts one or more queries and returns hits per query (titles, URLs, publication dates, summaries, text excerpts). Use this to find sources before scraping, citing, or writing a memo.

Tips:
- For multi-topic work, pass all queries in a single call — they run in parallel server-side. Don't issue one call per query across turns.
- The default \`numResults: 6\` is right for "find me a few sources." Bump to 12-20 only when you need recall (scanning a landscape, surveying a category). Higher numbers cost more tokens to read back.
- Use \`category\` per query when you actually want a narrow type (\`research paper\`, \`github\`, \`linkedin profile\`). Leave it off when you'd rather see a mix.
- Search results are *pointers*. The \`summary\` and \`excerpt\` are starting context, not citations. If you're going to assert a fact from a result, follow up with \`web_scrape\` on the URL and quote what you actually read — don't cite from the summary.`,
    inputSchema,
    execute: async ({ queries }) => {
      if (!apiKey) {
        return {
          error:
            "EXA_API_KEY is not set. Ask the user to add it via `wrangler secret put EXA_API_KEY` or their Cloudflare dashboard.",
          results: queries.map((q) => ({
            query: q.query,
            error: "EXA_API_KEY is not set.",
            hits: [] as Hit[],
          })),
        };
      }
      const results = await Promise.all(
        queries.map((q) => runOneQuery(apiKey, q)),
      );
      return { results };
    },
  });
}
