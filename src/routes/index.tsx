import { createFileRoute } from "@tanstack/react-router";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useEffect, useRef } from "react";

import InputBox from "../components/chat/InputBox";
import MessageView from "../components/chat/MessageView";

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

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming]);

  const hasMessages = messages.length > 0;
  const showBusy = isStreaming || status === "submitted";

  return (
    <main className="mx-auto flex h-[calc(100vh-4.25rem)] w-full max-w-5xl flex-col px-4 pb-4 pt-4">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pb-6">
        {hasMessages ? (
          messages.map((message) => (
            <MessageView key={message.id} message={message} />
          ))
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
          onStop={stop}
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
