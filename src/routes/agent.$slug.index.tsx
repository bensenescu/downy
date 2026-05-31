import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/agent/$slug/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/agent/$slug/chat/$sessionId",
      params: { slug: params.slug, sessionId: "default" },
      replace: true,
    });
  },
});
