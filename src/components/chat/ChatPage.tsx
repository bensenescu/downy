import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  devResetDO,
  editLastMessage,
  revertLastMessage,
  startBootstrap,
} from "../../lib/api-client";
import { useCurrentAgentSlug } from "../../lib/agents";
import AgentPanel from "./AgentPanel";
import InputBox from "./InputBox";
import MessageView, { turnHasSideEffects } from "./MessageView";

function isSyntheticMessage(message: UIMessage): boolean {
  const meta = message.metadata;
  if (typeof meta !== "object" || meta === null) return false;
  const m = meta as { kickoff?: unknown; backgroundTaskResult?: unknown };
  return m.kickoff === true || m.backgroundTaskResult === true;
}

type BackgroundTaskSource = {
  taskId: string;
  taskKind: string;
  status: "done" | "error";
};

// A background-task completion is delivered as a synthetic user message that
// is filtered from the chat. The next assistant message is the agent's reply
// to that completion — so we tag it with the source task so the UI can render
// a "from background task X" header on the visible message.
function readBackgroundTaskSource(
  message: UIMessage,
): BackgroundTaskSource | null {
  const meta = message.metadata;
  if (typeof meta !== "object" || meta === null) return null;
  const m = meta as {
    backgroundTaskResult?: unknown;
    taskId?: unknown;
    taskKind?: unknown;
    backgroundTaskStatus?: unknown;
  };
  if (m.backgroundTaskResult !== true) return null;
  if (typeof m.taskId !== "string" || typeof m.taskKind !== "string") {
    return null;
  }
  const status = m.backgroundTaskStatus === "error" ? "error" : "done";
  return { taskId: m.taskId, taskKind: m.taskKind, status };
}

export default function ChatPage() {
  const slug = useCurrentAgentSlug();
  const agent = useAgent({
    agent: "DownyAgent",
    name: slug,
    protocol: window.location.protocol === "https:" ? "wss" : "ws",
  });

  const { messages, sendMessage, stop, status, isStreaming, error } =
    useAgentChat({
      agent,
      // Skip the initial HTTP `/get-messages` fetch. During SSR the agent URL
      // resolves to a dummy host (partysocket falls back to "dummy-domain.com"
      // when `window` is undefined), so the subrequest fails with a Cloudflare
      // "remote: true" error. The Think agent already sends the full message
      // history over the WebSocket on connect (MSG_CHAT_MESSAGES), so we don't
      // need the HTTP fetch for initial state.
      getInitialMessages: null,
    });

  useEffect(() => {
    console.log("[chat] status change", { status, isStreaming });
  }, [status, isStreaming]);

  // Surface the actual error that flipped status -> "error". The AI SDK
  // captures it on `error`; without this, all we'd see is the cancel that the
  // SDK fires *as cleanup* after it threw, which is misleading. The most
  // common cause is a `UIMessageStreamError` (e.g. text-delta with no prior
  // text-start) — its `chunkType` / `chunkId` point at the malformed chunk.
  useEffect(() => {
    if (!error) return;
    const getProp = (key: string): unknown =>
      Object.prototype.hasOwnProperty.call(error, key)
        ? Reflect.get(error, key)
        : undefined;
    console.error("[chat] stream error", {
      name: error.name,
      message: error.message,
      chunkType: getProp("chunkType"),
      chunkId: getProp("chunkId"),
      stack: error.stack,
    });
  }, [error]);

  useEffect(() => {
    const onOpen = () => {
      console.log("[chat] socket open");
    };
    const onClose = (event: CloseEvent) => {
      console.warn("[chat] socket close", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
    };
    const onError = () => {
      console.error("[chat] socket error");
    };
    agent.addEventListener("open", onOpen);
    agent.addEventListener("close", onClose);
    agent.addEventListener("error", onError);
    return () => {
      agent.removeEventListener("open", onOpen);
      agent.removeEventListener("close", onClose);
      agent.removeEventListener("error", onError);
    };
  }, [agent]);

  // Instrument outgoing WebSocket frames to catch the exact moment the client
  // sends `cf_agent_chat_request_cancel`. This is the protocol message that
  // trips the server's AbortRegistry and produces "Turn ended before this
  // completed". The cancel is sent from `@cloudflare/ai-chat` when the AI
  // SDK's internal AbortController aborts — which can happen silently on
  // unmount, StrictMode double-invocation, or a new sendMessage during an
  // active stream. The stack trace names the actual caller.
  useEffect(() => {
    const sendable = agent as { send: (data: string) => void };
    const originalSend = sendable.send.bind(sendable);
    sendable.send = (data: string) => {
      if (
        typeof data === "string" &&
        data.includes("cf_agent_chat_request_cancel")
      ) {
        console.warn("[chat] sending CANCEL", {
          payload: data,
          stack: new Error().stack,
        });
      }
      return originalSend(data);
    };
    return () => {
      sendable.send = originalSend;
    };
  }, [agent]);

  const loggedStop = useCallback(() => {
    console.warn("[chat] stop() called", {
      status,
      isStreaming,
      stack: new Error().stack,
    });
    void stop();
  }, [stop, status, isStreaming]);

  const visibleMessages = useMemo(
    () => messages.filter((m) => !isSyntheticMessage(m)),
    [messages],
  );

  // Walk the unfiltered transcript: if an assistant message is preceded by one
  // or more background-task-completion synthetic messages, the assistant is
  // replying to those completions. Tag the assistant message with the most
  // recent task so MessageView can render a "from background task" header.
  const backgroundTaskSourceById = useMemo(() => {
    const map = new Map<string, BackgroundTaskSource>();
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      // Walk backward through any consecutive synthetic background-task
      // completions; the closest one is the proximate trigger.
      for (let j = i - 1; j >= 0; j--) {
        const prev = messages[j];
        const src = readBackgroundTaskSource(prev);
        if (src) {
          map.set(m.id, src);
          break;
        }
        if (!isSyntheticMessage(prev)) break;
      }
    }
    return map;
  }, [messages]);

  // The Edit + Undo affordances live on the *last* user / assistant message
  // respectively. Computing the IDs once per render keeps the predicate
  // inside the .map() cheap — and lets us also derive the side-effect
  // warning from the last assistant message's tool parts.
  const { lastUserId, lastAssistantId, lastTurnHasSideEffects } =
    useMemo(() => {
      let userId: string | null = null;
      let assistantId: string | null = null;
      let assistantSideEffects = false;
      for (let i = visibleMessages.length - 1; i >= 0; i--) {
        const m = visibleMessages[i];
        if (m.role === "assistant" && assistantId === null) {
          assistantId = m.id;
          assistantSideEffects = turnHasSideEffects(m);
        } else if (m.role === "user" && userId === null) {
          userId = m.id;
        }
        if (userId !== null && assistantId !== null) break;
      }
      return {
        lastUserId: userId,
        lastAssistantId: assistantId,
        lastTurnHasSideEffects: assistantSideEffects,
      };
    }, [visibleMessages]);

  // Draft of a message being edited. Non-null when the user has clicked Edit
  // on their last message. The InputBox watches this and prefills its
  // textarea; the next submit calls editLastMessage instead of sendMessage.
  const [editDraft, setEditDraft] = useState<string | null>(null);

  const handleEdit = useCallback((text: string) => {
    setEditDraft(text);
  }, []);

  const handleRevert = useCallback(() => {
    void revertLastMessage(slug).catch((err: unknown) => {
      console.error("[chat] revertLastMessage failed", err);
    });
  }, [slug]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Stay pinned to the bottom while the user is following along, but release
  // that pin the moment they scroll up to review earlier messages. Re-engages
  // when they scroll back to the bottom themselves.
  const pinnedToBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      pinnedToBottomRef.current = distanceFromBottom < 40;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pinnedToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [visibleMessages, isStreaming]);

  const handleSend = useCallback(
    (text: string) => {
      pinnedToBottomRef.current = true;
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      if (editDraft !== null) {
        // Edit mode: replace the last user message instead of appending. The
        // server truncates the prior turn and starts a new one — the Think
        // SDK broadcasts the updated transcript, so the client doesn't need
        // to optimistically prune anything.
        setEditDraft(null);
        void editLastMessage(slug, text).catch((err: unknown) => {
          console.error("[chat] editLastMessage failed", err);
        });
      } else {
        void sendMessage({ text });
      }
    },
    [editDraft, sendMessage, slug],
  );

  // Kick off bootstrap onboarding once per mount, when the chat appears empty.
  // The server is the source of truth — it no-ops if the chat already has
  // messages or the ritual is complete. The ref guards against React 19
  // Strict-Mode double-invocation and re-renders once messages arrive.
  const kickoffFired = useRef(false);
  useEffect(() => {
    if (kickoffFired.current) return;
    if (messages.length > 0) {
      kickoffFired.current = true;
      return;
    }
    kickoffFired.current = true;
    void startBootstrap(slug).catch((err: unknown) => {
      console.error("startBootstrap failed", err);
    });
  }, [messages.length, slug]);

  // Show "Downy is working…" only when there is no visible assistant reply
  // yet. Once an assistant message appears, the user can see content
  // streaming — a separate indicator alongside it reads as "stuck" even when
  // the agent is legitimately running follow-up steps (tool calls, etc.).
  const lastMessage = visibleMessages[visibleMessages.length - 1];
  const showBusy =
    (isStreaming || status === "submitted") &&
    lastMessage?.role !== "assistant";

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full">
      <AgentPanel agent={agent} />
      <main className="mx-auto flex h-full w-full max-w-5xl flex-col px-4 pb-4 pt-4">
        {import.meta.env.DEV ? <DevResetButton /> : null}
        <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto pb-6">
          {visibleMessages.map((message, idx) => {
            const isLast = idx === visibleMessages.length - 1;
            const turnEnded =
              !isLast || (!isStreaming && status !== "submitted");
            // Affordances only on the last user / last assistant message,
            // and only when nothing is in flight — truncating mid-stream
            // would race with the server and produce inconsistent state.
            const idle = !isStreaming && status !== "submitted";
            const showEdit = idle && message.id === lastUserId;
            const showRevert = idle && message.id === lastAssistantId;
            return (
              <MessageView
                key={message.id}
                message={message}
                turnEnded={turnEnded}
                onEdit={showEdit ? handleEdit : undefined}
                onRevert={showRevert ? handleRevert : undefined}
                hasSideEffects={
                  (showEdit || showRevert) && lastTurnHasSideEffects
                }
                backgroundTaskSource={backgroundTaskSourceById.get(message.id)}
              />
            );
          })}
          {showBusy ? (
            <div className="flex items-center gap-2 text-xs text-base-content/60">
              <span className="loading loading-dots loading-xs text-primary" />
              <span>Downy is working…</span>
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex-shrink-0">
          {editDraft !== null ? (
            <div className="mb-2 flex items-center justify-between rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning-content">
              <span>
                Editing your last message — the previous reply will be
                discarded.
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => {
                  setEditDraft(null);
                }}
              >
                Cancel
              </button>
            </div>
          ) : null}
          <InputBox
            onSend={handleSend}
            onStop={loggedStop}
            busy={showBusy}
            draft={editDraft}
            onCancelDraft={() => {
              setEditDraft(null);
            }}
          />
        </div>
      </main>
    </div>
  );
}

function DevResetButton() {
  const slug = useCurrentAgentSlug();
  const [busy, setBusy] = useState(false);
  async function handleReset() {
    const ok = window.confirm(
      "Wipe DO messages and re-seed BOOTSTRAP.md? The page will reload.",
    );
    if (!ok) return;
    setBusy(true);
    try {
      await devResetDO(slug);
      window.location.reload();
    } catch (err) {
      setBusy(false);
      window.alert(
        `Reset failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return (
    <div className="mb-2 flex justify-end">
      <button
        type="button"
        onClick={() => void handleReset()}
        disabled={busy}
        className="btn btn-ghost btn-xs text-error/70 hover:text-error"
        title="Dev only — wipe DO messages and re-seed BOOTSTRAP.md"
      >
        {busy ? "Resetting…" : "Reset DO"}
      </button>
    </div>
  );
}
