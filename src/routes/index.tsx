import { ClientOnly, createFileRoute } from "@tanstack/react-router";

import ChatPage from "../components/chat/ChatPage";

export const Route = createFileRoute("/")({ component: ChatRoute });

// The agents/useAgentChat hooks talk to a Durable Object over WebSocket and
// read `window.location`. On the server there's no window, so PartySocket
// falls back to "dummy-domain.com" and the SSR fetch blows up. `ClientOnly`
// defers rendering until hydration, when a real host is available.
function ChatRoute() {
  return (
    <ClientOnly fallback={<ChatFallback />}>
      <ChatPage />
    </ClientOnly>
  );
}

function ChatFallback() {
  return (
    <main className="mx-auto flex h-[calc(100vh-4.25rem)] w-full max-w-5xl flex-col px-4 pb-4 pt-4" />
  );
}
