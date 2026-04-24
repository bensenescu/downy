// Stubs `_aborts.cancel` on a Think instance to a no-op so client-initiated
// cancels don't kill in-flight turns. Think's protocol handler translates
// `cf_agent_chat_request_cancel` into `_aborts.cancel(id)`; we intercept that
// so StrictMode double-mounts, tab close, navigation, and HMR reloads no
// longer end the turn. Buffered chunks replay on reconnect; the final
// assistant message persists and broadcasts regardless. `destroyAll()` stays
// wired — only `resetTurnState()` / `_handleClear()` call it, and those are
// explicit user intents.
//
// Call once from `onStart`. Uses `Reflect.get`/`set` to reach the base
// class's `private _aborts` — Think types it private but it's a plain object
// at runtime.
export function ignoreClientCancels(instance: object, logPrefix: string): void {
  const aborts = getLiveAborts(instance);
  Reflect.set(aborts, "cancel", (id: string) => {
    console.log(`${logPrefix} ignoring client cancel; DO keeps streaming`, {
      requestId: id,
    });
  });
}

function getLiveAborts(instance: unknown): object {
  if (
    typeof instance !== "object" ||
    instance === null ||
    !("_aborts" in instance)
  ) {
    throw new Error("Think._aborts not found on agent instance");
  }
  const rawAborts: unknown = Reflect.get(instance, "_aborts");
  if (typeof rawAborts !== "object" || rawAborts === null) {
    throw new Error("Think._aborts is not an object");
  }
  const cancel: unknown = Reflect.get(rawAborts, "cancel");
  const destroyAll: unknown = Reflect.get(rawAborts, "destroyAll");
  if (typeof cancel !== "function" || typeof destroyAll !== "function") {
    throw new Error("Think._aborts shape changed");
  }
  return rawAborts;
}
