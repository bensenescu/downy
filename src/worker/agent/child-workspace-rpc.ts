// Public Workspace methods the child is allowed to call via RPC. Mirrors the
// surface declared in @cloudflare/shell's Workspace class (see filesystem.d.ts)
// minus the internal `_*` methods. This is the safety boundary for
// `workspaceCallForChild`; anything not in this set is rejected.
const ALLOWED_WORKSPACE_METHODS = new Set<string>([
  "stat",
  "lstat",
  "readFile",
  "readFileBytes",
  "writeFile",
  "writeFileBytes",
  "appendFile",
  "deleteFile",
  "fileExists",
  "exists",
  "readDir",
  "glob",
  "mkdir",
  "rm",
  "cp",
  "mv",
  "diff",
  "diffContent",
  "symlink",
  "readlink",
  "getWorkspaceInfo",
]);

const CHILD_MUTATION_PATH_ARG_INDEXES = new Map<string, readonly number[]>([
  ["writeFile", [0]],
  ["writeFileBytes", [0]],
  ["appendFile", [0]],
  ["deleteFile", [0]],
  ["mkdir", [0]],
  ["rm", [0]],
  ["cp", [1]],
  ["mv", [0, 1]],
  ["symlink", [1]],
]);

function normalizeWorkspacePath(path: string): string {
  const segments = path.replace(/^\/+/, "").split("/").filter(Boolean);
  if (segments.length === 0) throw new Error("workspace path is required");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`workspace path cannot contain dot segments: ${path}`);
  }
  return segments.join("/");
}

function assertChildWritablePath(path: string): void {
  const normalized = normalizeWorkspacePath(path);
  if (normalized.startsWith("workspace/") || normalized.startsWith("skills/")) {
    return;
  }
  throw new Error(
    `Child workspace writes are limited to workspace/ and skills/: ${path}`,
  );
}

export function assertChildWorkspaceCallAllowed(
  method: string,
  args: unknown[],
): void {
  if (!ALLOWED_WORKSPACE_METHODS.has(method)) {
    throw new Error(`workspace method not allowed via RPC: ${method}`);
  }

  const indexes = CHILD_MUTATION_PATH_ARG_INDEXES.get(method);
  if (!indexes) return;
  for (const index of indexes) {
    const value = args[index];
    if (typeof value !== "string") {
      throw new Error(`workspace method ${method} requires a path string`);
    }
    assertChildWritablePath(value);
  }
}
