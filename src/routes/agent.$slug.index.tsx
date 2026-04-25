import { ClientOnly, createFileRoute } from "@tanstack/react-router";

import ChatPage from "../components/chat/ChatPage";

export const Route = createFileRoute("/agent/$slug/")({ component: ChatRoute });

// The agents/useAgentChat hooks talk to a Durable Object over WebSocket and
// read `window.location`. On the server there's no window, so PartySocket
// falls back to "dummy-domain.com" and the SSR fetch blows up. `ClientOnly`
// defers rendering until hydration, when a real host is available.
function ChatRoute() {
  const { slug } = Route.useParams();
  // Keying the chat by slug forces a full remount when the user switches
  // agents — `useAgent` from `agents/react` opens its WebSocket once on
  // mount and doesn't tear it down when its `name` prop changes, so without
  // this the socket stays pointed at the previous agent and the new one's
  // chat never loads. Remounting also resets scroll refs, draft input,
  // streaming state, etc., which is what the user expects on agent switch.
  return (
    <ClientOnly fallback={<ChatFallback />}>
      <ChatPage key={slug} />
    </ClientOnly>
  );
}

function ChatFallback() {
  return <div className="flex h-[calc(100vh-3.5rem)] w-full" />;
}
