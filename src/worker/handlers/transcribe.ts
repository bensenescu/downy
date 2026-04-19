const JSON_HEADERS = { "content-type": "application/json" };

// Cloudflare Workers AI — Whisper large v3 turbo.
// https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/
const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo" as const;

// 25 MB upper bound on the raw audio we'll accept. Whisper itself handles up
// to a few minutes of audio comfortably; this guard prevents runaway uploads.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Convert a Uint8Array to a base64 string without blowing the call stack on
 * large payloads. `String.fromCharCode(...bytes)` would overflow for anything
 * more than ~100 KB, so we chunk the input.
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export async function handleTranscribeRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength === 0) {
      return json({ error: "Empty audio body" }, 400);
    }
    if (buffer.byteLength > MAX_AUDIO_BYTES) {
      return json({ error: "Audio too large (25 MB max)" }, 413);
    }

    const audioBase64 = bytesToBase64(new Uint8Array(buffer));
    const url = new URL(request.url);
    const language = url.searchParams.get("language") ?? undefined;

    const result = await env.AI.run(WHISPER_MODEL, {
      audio: audioBase64,
      ...(language ? { language } : {}),
    });

    const text = (result.text ?? "").trim();
    return json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
}
