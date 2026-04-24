import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deleteChatMessage,
  devResetDO,
  startBootstrap,
} from "../../lib/api-client";
import InputBox from "./InputBox";
import MessageView from "./MessageView";

function isKickoffMessage(message: UIMessage): boolean {
  const meta = message.metadata;
  return (
    typeof meta === "object" &&
    meta !== null &&
    "kickoff" in meta &&
    (meta as { kickoff?: unknown }).kickoff === true
  );
}

export default function ChatPage() {
  const agent = useAgent({
    agent: "OpenClawAgent",
    name: "singleton",
    protocol: window.location.protocol === "https:" ? "wss" : "ws",
  });

  const { messages, sendMessage, stop, status, isStreaming } = useAgentChat({
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

  const loggedStop = useCallback(() => {
    console.warn("[chat] stop() called", {
      status,
      isStreaming,
      stack: new Error().stack,
    });
    void stop();
  }, [stop, status, isStreaming]);

  // Deletion is fire-and-forget from the UI's perspective: the server removes
  // the message from the session and broadcasts the new transcript, which
  // `useAgentChat` applies via its own WebSocket handler — so we don't have
  // to touch local state here.
  const handleDeleteMessage = useCallback(async (messageId: string) => {
    try {
      await deleteChatMessage(messageId);
    } catch (err) {
      console.error("[chat] deleteChatMessage failed", {
        messageId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }, []);

  const visibleMessages = useMemo(
    () => messages.filter((m) => !isKickoffMessage(m)),
    [messages],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [visibleMessages, isStreaming]);

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
    void startBootstrap().catch((err: unknown) => {
      console.error("startBootstrap failed", err);
    });
  }, [messages.length]);

  // Show "Claw is working…" only when there is no visible assistant reply
  // yet. Once an assistant message appears, the user can see content
  // streaming — a separate indicator alongside it reads as "stuck" even when
  // the agent is legitimately running follow-up steps (tool calls, etc.).
  const lastMessage = visibleMessages[visibleMessages.length - 1];
  const showBusy =
    (isStreaming || status === "submitted") &&
    lastMessage?.role !== "assistant";

  return (
    <main className="mx-auto flex h-[calc(100vh-4.25rem)] w-full max-w-5xl flex-col px-4 pb-4 pt-4">
      {import.meta.env.DEV ? <DevResetButton /> : null}
      <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto pb-6">
        {visibleMessages.map((message, idx) => {
          const isLast = idx === visibleMessages.length - 1;
          const turnEnded = !isLast || (!isStreaming && status !== "submitted");
          return (
            <MessageView
              key={message.id}
              message={message}
              turnEnded={turnEnded}
              onDelete={handleDeleteMessage}
            />
          );
        })}
        {showBusy ? (
          <div className="flex items-center gap-2 text-xs text-base-content/60">
            <span className="loading loading-dots loading-xs text-primary" />
            <span>Claw is working…</span>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex-shrink-0">
        <InputBox
          onSend={(text) => void sendMessage({ text })}
          onStop={loggedStop}
          busy={showBusy}
        />
        <p className="mt-2 text-center text-xs text-base-content/60">
          One thread. Shift+Enter for newline.
        </p>
      </div>
    </main>
  );
}

function DevResetButton() {
  const [busy, setBusy] = useState(false);
  async function handleReset() {
    const ok = window.confirm(
      "Wipe DO messages and re-seed BOOTSTRAP.md? The page will reload.",
    );
    if (!ok) return;
    setBusy(true);
    try {
      await devResetDO();
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
