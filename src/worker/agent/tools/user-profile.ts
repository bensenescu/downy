import { tool } from "ai";
import { z } from "zod";

import { USER_PATH } from "../core-files";
import { readUserFile, writeUserFile } from "../../db/profile";

export function createReadUserProfileTool(args: { db: D1Database }) {
  return tool({
    description:
      "Read the shared, D1-backed user profile file (`identity/USER.md`). Use this before replacing the user profile so you preserve existing durable notes.",
    inputSchema: z.object({}),
    execute: async () => {
      const { content, isDefault } = await readUserFile(args.db);
      return { path: USER_PATH, content, isDefault };
    },
  });
}

export function createWriteUserProfileTool(args: { db: D1Database }) {
  return tool({
    description:
      "Replace the shared, D1-backed user profile file (`identity/USER.md`). Use only for durable facts or preferences about the user, not task notes.",
    inputSchema: z.object({
      content: z
        .string()
        .describe("Full replacement Markdown content for identity/USER.md."),
    }),
    execute: async ({ content }) => {
      await writeUserFile(args.db, content);
      return {
        path: USER_PATH,
        bytesWritten: new TextEncoder().encode(content).byteLength,
        lines: content.split("\n").length,
      };
    },
  });
}
