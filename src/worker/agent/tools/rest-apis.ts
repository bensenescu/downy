import { tool } from "ai";
import type { Tool } from "ai";
import { z } from "zod";

import {
  authHeaders,
  type ApiAuthMeta,
  type ApiAuthSecret,
  type RestApiIntegration,
  NAME_PATTERN,
} from "../integrations";
import type { OpenClawAgent } from "../OpenClawAgent";

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const authSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("bearer"),
    token: z.string().min(1),
  }),
  z.object({
    kind: z.literal("basic"),
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  z.object({
    kind: z.literal("header"),
    headerName: z.string().regex(HEADER_NAME, {
      message: "Invalid header name",
    }),
    value: z.string().min(1),
  }),
]);

const connectInputSchema = z.object({
  name: z.string().regex(NAME_PATTERN, {
    message:
      "Use 1–32 chars, lowercase a-z / 0-9 / underscore / hyphen; must start and end with alphanumeric.",
  }),
  baseUrl: z
    .string()
    .url()
    .describe(
      "API base URL, e.g. 'https://api.dataforseo.com'. Outbound calls go to {baseUrl}{path}.",
    ),
  description: z
    .string()
    .max(400)
    .optional()
    .describe(
      "One-line note about this integration so future turns remember what it's for, e.g. 'DataForSEO SERP / keyword data'.",
    ),
  auth: authSchema.describe(
    "How outbound requests are authenticated. The credential value is stored in DO storage and signed onto every request server-side; the model never sees it again.",
  ),
});

const disconnectInputSchema = z.object({
  id: z.string().min(1).describe("The id returned by connect_rest_api."),
});

const listInputSchema = z.object({});

const requestInputSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]),
  path: z
    .string()
    .min(1)
    .describe("Path appended to the integration's baseUrl, e.g. '/v3/serp/...'."),
  query: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe("Query string parameters (will be URL-encoded)."),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Extra request headers. Auth headers are added automatically — do NOT pass auth here.",
    ),
  body: z
    .unknown()
    .optional()
    .describe(
      "Request body. Objects are JSON-encoded; strings are sent as text/plain. Omit for GET/HEAD.",
    ),
});

export function createConnectRestApiTool(args: { agent: OpenClawAgent }) {
  return tool({
    description:
      "Persist a REST API integration to this agent's durable storage. The auth credential lives in DO storage and is signed onto every outbound call from the host — the model never sees it after this call. Once connected, a new tool `<name>__request` becomes available on the next turn for issuing arbitrary requests against the API. Use this for vendors that don't have a hosted MCP endpoint (e.g. DataForSEO via its REST API). Confirm credentials with the user before calling — never invent or guess them. Returns the integration id and the name of the request tool that's now available.",
    inputSchema: connectInputSchema,
    execute: async ({ name, baseUrl, description, auth }) => {
      const id = await args.agent.connectRestApi({
        name,
        baseUrl,
        description,
        auth,
      });
      return {
        id,
        toolName: `${name}__request`,
        message: `Integration '${name}' connected. Tool '${name}__request' will be available on the next turn — call it with { method, path, query?, body? } to invoke endpoints on ${baseUrl}.`,
      };
    },
  });
}

export function createListRestApisTool(args: { agent: OpenClawAgent }) {
  return tool({
    description:
      "List REST API integrations registered to this agent. Returns names, base URLs, auth kinds (not credentials), and the per-integration request tool name. Use before connecting to check for duplicates, or when the user asks 'what APIs do I have wired up'.",
    inputSchema: listInputSchema,
    execute: async () => {
      const integrations = await args.agent.listRestApis();
      return {
        integrations: integrations.map((it) => ({
          id: it.id,
          name: it.name,
          baseUrl: it.baseUrl,
          description: it.description,
          authKind: it.authMeta.kind,
          toolName: `${it.name}__request`,
          createdAt: it.createdAt,
        })),
      };
    },
  });
}

export function createDisconnectRestApiTool(args: { agent: OpenClawAgent }) {
  return tool({
    description:
      "Remove a REST API integration by id (use list_rest_apis to find ids). Wipes the stored credential and removes the per-integration request tool from the next turn.",
    inputSchema: disconnectInputSchema,
    execute: async ({ id }) => {
      const removed = await args.agent.disconnectRestApi(id);
      return { removed, id };
    },
  });
}

// Build the dynamic per-integration request tool. The tool's `execute` reads
// the secret from the agent (which reads it from DO storage) right before the
// fetch — the secret never sits in the tool definition itself.
export function buildIntegrationRequestTool(
  agent: OpenClawAgent,
  integration: RestApiIntegration,
): Tool {
  return tool({
    description: `Issue an HTTP request to the '${integration.name}' API at ${integration.baseUrl}. Auth is attached automatically (kind: ${integration.authMeta.kind}). ${integration.description ?? ""}`.trim(),
    inputSchema: requestInputSchema,
    execute: async ({ method, path, query, headers, body }) => {
      const secret = await agent.getRestApiSecret(integration.id);
      if (!secret) {
        throw new Error(
          `Integration '${integration.name}' was disconnected; reconnect via connect_rest_api.`,
        );
      }
      return executeIntegrationRequest({
        baseUrl: integration.baseUrl,
        authMeta: integration.authMeta,
        secret,
        method,
        path,
        query,
        headers,
        body,
      });
    },
  });
}

type ExecuteRequestArgs = {
  baseUrl: string;
  authMeta: ApiAuthMeta;
  secret: ApiAuthSecret;
  method: string;
  path: string;
  query?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  body?: unknown;
};

async function executeIntegrationRequest(args: ExecuteRequestArgs): Promise<{
  status: number;
  ok: boolean;
  contentType: string | null;
  body: unknown;
}> {
  const url = new URL(args.path, args.baseUrl);
  if (args.query) {
    for (const [k, v] of Object.entries(args.query)) {
      url.searchParams.set(k, String(v));
    }
  }
  const merged: Record<string, string> = {
    accept: "application/json",
    ...args.headers,
    ...authHeaders(args.secret, args.authMeta),
  };
  let bodyInit: BodyInit | undefined;
  if (args.body !== undefined && args.method !== "GET" && args.method !== "HEAD") {
    if (typeof args.body === "string") {
      bodyInit = args.body;
      merged["content-type"] ??= "text/plain; charset=utf-8";
    } else {
      bodyInit = JSON.stringify(args.body);
      merged["content-type"] ??= "application/json";
    }
  }
  const response = await fetch(url.toString(), {
    method: args.method,
    headers: merged,
    body: bodyInit,
  });
  const contentType = response.headers.get("content-type");
  let parsed: unknown;
  if (contentType?.includes("application/json")) {
    parsed = await response.json().catch(() => null);
  } else {
    parsed = await response.text();
  }
  return {
    status: response.status,
    ok: response.ok,
    contentType,
    body: parsed,
  };
}
