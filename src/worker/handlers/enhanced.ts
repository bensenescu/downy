import {
  listAiProviders,
  createAiProvider,
  updateAiProvider,
  deleteAiProvider,
  listSessions,
  createSession,
  deleteSession,
  getAiProvider,
  getTelegramChat,
  setTelegramChat,
  readPreferences,
} from "../db/profile";
import { getAgentStub } from "../lib/get-agent";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function getTelegramToken(db: D1Database, env: Cloudflare.Env) {
  const prefs = await readPreferences(db);
  return (prefs as any).telegram_bot_token || (env as any).TELEGRAM_BOT_TOKEN;
}

async function sendTelegramMessage(
  db: D1Database,
  env: Cloudflare.Env,
  chatId: string,
  text: string,
) {
  const token = await getTelegramToken(db, env);
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

export async function handleEnhancedRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  const url = new URL(request.url);

  // Provider Management
  if (url.pathname === "/api/providers") {
    if (request.method === "GET") {
      const providers = await listAiProviders(env.DB);
      return json({ providers });
    }
    if (request.method === "POST") {
      const body: any = await request.json();
      const provider = await createAiProvider(env.DB, {
        id: crypto.randomUUID(),
        ...body,
      });
      return json({ provider });
    }
  }

  if (url.pathname.startsWith("/api/providers/")) {
    const id = url.pathname.split("/").pop()!;
    if (request.method === "PUT") {
      const body = await request.json();
      await updateAiProvider(env.DB, id, body as any);
      return json({ ok: true });
    }
    if (request.method === "DELETE") {
      await deleteAiProvider(env.DB, id);
      return json({ ok: true });
    }
    if (url.pathname.endsWith("/fetch-models") && request.method === "POST") {
      const provider = await getAiProvider(env.DB, id);
      if (!provider) return json({ error: "Provider not found" }, 404);

      try {
        if (provider.type === "openai" || provider.type === "openrouter") {
          const endpoint =
            provider.endpoint ||
            (provider.type === "openrouter"
              ? "https://openrouter.ai/api/v1"
              : "https://api.openai.com/v1");
          const res = await fetch(`${endpoint}/models`, {
            headers: { Authorization: `Bearer ${provider.apiKey}` },
          });
          const data: any = await res.json();
          const models = data.data?.map((m: any) => m.id) || [];
          return json({ models });
        }

        if (provider.type === "google") {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${provider.apiKey}`,
          );
          const data: any = await res.json();
          const models =
            data.models?.map((m: any) => m.name.replace("models/", "")) || [];
          return json({ models });
        }

        // Fallback for others
        return json({
          models: ["gpt-4o", "claude-3-5-sonnet-latest", "gemini-1.5-pro"],
        });
      } catch (err) {
        console.error("Failed to fetch models", err);
        return json({ error: "Failed to fetch models" }, 500);
      }
    }
  }

  // Session Management
  const sessionMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/sessions$/);
  if (sessionMatch) {
    const slug = sessionMatch[1];
    if (request.method === "GET") {
      const sessions = await listSessions(env.DB, slug);
      return json({ sessions });
    }
    if (request.method === "POST") {
      const body: any = await request.json();
      const session = await createSession(env.DB, {
        id: crypto.randomUUID(),
        agentSlug: slug,
        title: body.title || "New Chat",
      });
      return json({ session });
    }
  }

  if (url.pathname.startsWith("/api/sessions/")) {
    const id = url.pathname.split("/").pop()!;
    if (request.method === "DELETE") {
      await deleteSession(env.DB, id);
      return json({ ok: true });
    }
  }

  // Telegram Webhook
  if (url.pathname === "/api/telegram/webhook" && request.method === "POST") {
    const update: any = await request.json();
    if (update.message) {
      const chatId = String(update.message.chat.id);
      const text = update.message.text || "";

      // Check whitelist
      const prefs = await readPreferences(env.DB);
      const whitelist = (prefs as any).telegram_whitelist?.split(",") || [];
      if (whitelist.length > 0 && !whitelist.includes(chatId)) {
        console.warn(`Telegram message from non-whitelisted chat: ${chatId}`);
        return json({ ok: true });
      }

      if (text === "/start") {
        await sendTelegramMessage(
          env.DB,
          env,
          chatId,
          "Welcome! Please link this chat to an agent session in the Web UI, or use /link <agent-slug>.",
        );
        return json({ ok: true });
      }

      if (text.startsWith("/link ")) {
        const slug = text.split(" ")[1];
        if (slug) {
          const session = await createSession(env.DB, {
            id: crypto.randomUUID(),
            agentSlug: slug,
            title: `Telegram Chat (${chatId})`,
          });
          await setTelegramChat(env.DB, chatId, slug, session.id);
          await sendTelegramMessage(
            env.DB,
            env,
            chatId,
            `Linked to agent ${slug}.`,
          );
        }
        return json({ ok: true });
      }

      const mapping = await getTelegramChat(env.DB, chatId);
      if (mapping) {
        const stub = await getAgentStub(
          env,
          `${mapping.agentSlug}:${mapping.sessionId}`,
        );

        if (text === "/help") {
          const skills = await stub.listAgentSkills();
          const helpText =
            "Available skills:\n" +
            skills.map((s) => `/${s.name} - ${s.description}`).join("\n");
          await sendTelegramMessage(env.DB, env, chatId, helpText);
        } else if (text.startsWith("/")) {
          // Could implement custom commands based on skills
          await stub.saveMessages([
            {
              id: crypto.randomUUID(),
              role: "user",
              parts: [{ type: "text", text }],
              metadata: { telegram: true, chatId },
            },
          ]);
        } else {
          await stub.saveMessages([
            {
              id: crypto.randomUUID(),
              role: "user",
              parts: [{ type: "text", text }],
              metadata: { telegram: true, chatId },
            },
          ]);
        }
      } else {
        await sendTelegramMessage(
          env.DB,
          env,
          chatId,
          "This chat is not linked to any agent. Use /link <agent-slug> to link.",
        );
      }
      return json({ ok: true });
    }
  }

  return json({ error: "Not found" }, 404);
}
