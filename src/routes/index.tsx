import { createFileRoute } from "@tanstack/react-router";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useEffect, useRef } from "react";

import InputBox from "../components/chat/InputBox";
import MessageView from "../components/chat/MessageView";

export const Route = createFileRoute("/")({ component: ChatPage });

function ChatPage() {
  const agent = useAgent({
    agent: "OpenClawAgent",
    name: "singleton",
  });

  const { messages, sendMessage, stop, status, isStreaming } = useAgentChat({
    agent,
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
    <main className="page-wrap flex h-[calc(100vh-4.25rem)] flex-col px-4 pb-4 pt-4">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pb-6">
        {hasMessages ? (
          messages.map((message) => (
            <MessageView key={message.id} message={message} />
          ))
        ) : (
          <EmptyState />
        )}
        {showBusy ? (
          <div className="flex items-center gap-2 text-xs text-[var(--sea-ink-soft)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--lagoon)]" />
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
        <p className="mt-2 text-center text-[0.7rem] text-[var(--sea-ink-soft)]">
          One thread. Shift+Enter for newline.
        </p>
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <section className="island-shell rise-in relative overflow-hidden rounded-[2rem] px-6 py-10 sm:px-10 sm:py-12">
      <div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(79,184,178,0.32),transparent_66%)]" />
      <div className="pointer-events-none absolute -bottom-20 -right-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(47,106,74,0.18),transparent_66%)]" />
      <p className="island-kicker mb-3">One ongoing thread</p>
      <h1 className="display-title mb-4 max-w-3xl text-3xl leading-[1.05] font-bold tracking-tight text-[var(--sea-ink)] sm:text-5xl">
        Start a conversation with Claw.
      </h1>
      <p className="mb-6 max-w-2xl text-sm text-[var(--sea-ink-soft)] sm:text-base">
        Ask for research, notes, a breakdown of something complex. Claw searches
        the web, writes files in the workspace, and keeps durable memory so the
        thread stays coherent across weeks.
      </p>
      <ul className="grid gap-2 text-sm text-[var(--sea-ink-soft)] sm:grid-cols-2">
        <li className="island-shell rounded-xl px-3 py-2">
          Try:{" "}
          <em>Research the top three AI agent frameworks and write a memo.</em>
        </li>
        <li className="island-shell rounded-xl px-3 py-2">
          Try: <em>What do you know about me from USER.md?</em>
        </li>
        <li className="island-shell rounded-xl px-3 py-2">
          Try: <em>Read the latest release notes for TanStack Router.</em>
        </li>
        <li className="island-shell rounded-xl px-3 py-2">
          Try: <em>Save a note about my preferred tech stack.</em>
        </li>
      </ul>
    </section>
  );
}
