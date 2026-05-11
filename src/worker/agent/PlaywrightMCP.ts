import { env } from "cloudflare:workers";
import { createMcpAgent } from "@cloudflare/playwright-mcp";

export const PlaywrightMCP = createMcpAgent(env.BROWSER);
export type PlaywrightMCP = typeof PlaywrightMCP extends { prototype: infer R } ? R : any;
