import { Think } from "@cloudflare/think";
import { Workspace } from "@cloudflare/shell";
import type { FileInfo } from "@cloudflare/shell";
import { createWorkersAI } from "workers-ai-provider";
import type { LanguageModel, ToolSet } from "ai";
import type { Session } from "agents/experimental/memory/session";

import { buildSystemPrompt } from "./build-system-prompt";
import {
  CORE_FILES,
  coreFileMeta,
  isCorePath,
  resolveCoreFile,
  type CoreFileRecord,
} from "./core-files";
import { createWebScrapeTool } from "./tools/web-scrape";
import { createWebSearchTool } from "./tools/web-search";

export class OpenClawAgent extends Think {
  override workspace = new Workspace({
    sql: this.ctx.storage.sql,
    r2: this.env.WORKSPACE_BUCKET,
    name: () => this.name,
  });

  override maxSteps = 20;

  override chatRecovery = true;

  override getModel(): LanguageModel {
    const workersAI = createWorkersAI({ binding: this.env.AI });
    return workersAI(this.env.MODEL_ID);
  }

  override getTools(): ToolSet {
    return {
      web_search: createWebSearchTool(this.env.EXA_API_KEY),
      web_scrape: createWebScrapeTool(this.env.BROWSER),
    };
  }

  override configureSession(session: Session) {
    return session.withCachedPrompt();
  }

  override async beforeTurn() {
    const system = await buildSystemPrompt(this.workspace);
    return { system };
  }

  async listCoreFiles(): Promise<CoreFileRecord[]> {
    return Promise.all(
      CORE_FILES.map((meta) => resolveCoreFile(this.workspace, meta)),
    );
  }

  async readCoreFile(path: string): Promise<CoreFileRecord | null> {
    const meta = coreFileMeta(path);
    if (!meta) return null;
    return resolveCoreFile(this.workspace, meta);
  }

  async writeCoreFile(path: string, content: string): Promise<void> {
    if (!isCorePath(path)) {
      throw new Error("Path is not a core identity file");
    }
    await this.workspace.writeFile(path, content);
  }

  async listWorkspaceFiles(): Promise<FileInfo[]> {
    const entries = await this.workspace.readDir("/");
    return entries.filter((entry) => !isCorePath(entry.name));
  }

  async readWorkspaceFile(
    path: string,
  ): Promise<{ content: string; stat: FileInfo | null } | null> {
    const content = await this.workspace.readFile(path);
    if (content == null) return null;
    const stat = await this.workspace.stat(path);
    return { content, stat };
  }

  async writeWorkspaceFile(path: string, content: string): Promise<void> {
    if (isCorePath(path)) {
      throw new Error("Use writeCoreFile for identity files");
    }
    await this.workspace.writeFile(path, content);
  }

  async deleteWorkspaceFile(path: string): Promise<void> {
    if (isCorePath(path)) {
      throw new Error("Cannot delete identity files");
    }
    await this.workspace.deleteFile(path);
  }
}
