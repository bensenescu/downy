import { createFileRoute } from "@tanstack/react-router";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef } from "react";

import InputBox from "../components/chat/InputBox";
import MessageView from "../components/chat/MessageView";
import { startBootstrap } from "../lib/api-client";

function isKickoffMessage(message: UIMessage): boolean {
  const meta = message.metadata;
  return (
    typeof meta === "object" &&
    meta !== null &&
    "kickoff" in meta &&
    (meta as { kickoff?: unknown }).kickoff === true
  );
}

export const Route = createFileRoute("/")({
  ssr: false,
  component: ChatPage,
});

function ChatPage() {
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

  // Log every chat status transition so we can line them up against the
  // server-side turn timeline when a turn gets aborted unexpectedly.
  useEffect(() => {
    console.log("[chat] status change", { status, isStreaming });
  }, [status, isStreaming]);

  // WebSocket lifecycle — a disconnect / reconnect during an active stream
  // is a prime suspect for server-side aborts. `useAgent` returns a
  // `PartySocket` which is itself an `EventTarget` (inherits `addEventListener`
  // from the underlying WebSocket), so we just attach listeners directly.
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

  // Wrap `stop` so we can see whether the UI is triggering aborts (stop
  // button, unmount, etc.). The stack trace pinpoints the call site.
  const loggedStop = useCallback(() => {
    console.warn("[chat] stop() called", {
      status,
      isStreaming,
      stack: new Error().stack,
    });
    void stop();
  }, [stop, status, isStreaming]);

  // Hide the synthetic "begin" message used to trigger agent-first onboarding.
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

  const hasMessages = visibleMessages.length > 0;
  const showBusy = isStreaming || status === "submitted";

  return (
    <main className="mx-auto flex h-[calc(100vh-4.25rem)] w-full max-w-5xl flex-col px-4 pb-4 pt-4">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pb-6">
        {hasMessages ? (
          visibleMessages.map((message, idx) => {
            const isLast = idx === visibleMessages.length - 1;
            // A turn is "live" only for the last message while we are still
            // submitting or streaming. For every other message — and for the
            // last once the stream is ready/error — pending tool parts are
            // stale and should be shown as errored, not as a forever spinner.
            const turnEnded =
              !isLast || (!isStreaming && status !== "submitted");
            return (
              <MessageView
                key={message.id}
                message={message}
                turnEnded={turnEnded}
              />
            );
          })
        ) : (
          <EmptyState />
        )}
        {showBusy ? (
          <div className="flex items-center gap-2 text-xs text-base-content/60">
            <span className="loading loading-dots loading-xs text-primary" />
            <span>Claw is working…</span>
          </div>
        ) : null}
      </div>

      <div className="flex-shrink-0">
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

function EmptyState() {
  return (
    <section className="card border border-base-300 bg-base-100 shadow-xl">
      <div className="card-body gap-4">
        <p className="text-xs font-bold uppercase tracking-widest text-primary">
          One ongoing thread
        </p>
        <h1 className="card-title text-3xl font-bold tracking-tight sm:text-4xl">
          Start a conversation with Claw.
        </h1>
        <p className="max-w-2xl text-sm text-base-content/70 sm:text-base">
          Ask for research, notes, a breakdown of something complex. Claw
          searches the web, writes files in the workspace, and keeps durable
          memory so the thread stays coherent across weeks.
        </p>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          <li className="rounded-box border border-base-300 bg-base-200/50 px-3 py-2 text-base-content/80">
            Try:{" "}
            <em>
              Research the top three AI agent frameworks and write a memo.
            </em>
          </li>
          <li className="rounded-box border border-base-300 bg-base-200/50 px-3 py-2 text-base-content/80">
            Try: <em>What do you know about me from USER.md?</em>
          </li>
          <li className="rounded-box border border-base-300 bg-base-200/50 px-3 py-2 text-base-content/80">
            Try: <em>Read the latest release notes for TanStack Router.</em>
          </li>
          <li className="rounded-box border border-base-300 bg-base-200/50 px-3 py-2 text-base-content/80">
            Try: <em>Save a note about my preferred tech stack.</em>
          </li>
        </ul>
      </div>
    </section>
  );
}
