import type { Workspace } from "@cloudflare/shell";

import type { OpenClawAgent } from "./OpenClawAgent";

/**
 * A `Workspace`-shaped proxy that forwards every method call to the parent
 * `OpenClawAgent` over DO-to-DO RPC. Lets `ChildAgent` register the same
 * workspace-backed tools as the parent (skill writes, file read/write/edit/
 * delete, glob) without keeping a second authoritative copy of the workspace
 * inside the child DO.
 *
 * Built as a runtime `Proxy` rather than a hand-written class so it covers
 * the full Workspace public surface (~22 methods) without 22 boilerplate
 * forwarders. The parent enforces the allowlist on its side
 * (`ALLOWED_WORKSPACE_METHODS` in OpenClawAgent.ts) — the proxy itself does
 * not gate calls.
 *
 * Cast to `Workspace` is structural (Proxy intercepts every method); we mark
 * it `as unknown as Workspace` because the Proxy target is `{}` and TS can't
 * see through that.
 */
export function createRemoteWorkspace(
  getParent: () => Promise<DurableObjectStub<OpenClawAgent>>,
): Workspace {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      // Each property access returns a function, regardless of `prop` —
      // matches `Workspace`'s shape (every public member is a method).
      return async (...args: unknown[]) => {
        const parent = await getParent();
        return parent.workspaceCallForChild(prop, args);
      };
    },
  };
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- Proxy intercepts every Workspace method; structural match is enforced by ALLOWED_WORKSPACE_METHODS on the parent.
  return new Proxy({}, handler) as unknown as Workspace;
}
