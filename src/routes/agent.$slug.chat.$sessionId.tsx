import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import ChatPage from "../components/chat/ChatPage";

export const Route = createFileRoute("/agent/$slug/chat/$sessionId")({
  component: ChatRoute,
});

function ChatRoute() {
  const { slug, sessionId } = Route.useParams();
  return (
    <ClientOnly fallback={<ChatFallback />}>
      <ChatPage key={`${slug}:${sessionId}`} sessionId={sessionId} />
    </ClientOnly>
  );
}

function ChatFallback() {
  return <div className="flex h-[calc(100vh-3.5rem)] w-full md:h-screen" />;
}
