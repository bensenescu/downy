// Loads OAuth credentials from a pi-ai `auth.json` file, calls
// pi-ai's `getOAuthApiKey()` (which refreshes if expired), and writes
// any rotated credentials back to disk.
//
// File shape (created by `npx @mariozechner/pi-ai login openai-codex`):
//   {
//     "openai-codex": {
//       "access": "...",
//       "refresh": "...",
//       "expires": 1735000000000,
//       "accountId": "..."
//     }
//   }
//
// Other pi-ai OAuth providers (`anthropic`, `github-copilot`,
// `google-gemini-cli`, `google-antigravity`) live under their own keys
// in the same file — switch by changing PI_OAUTH_PROVIDER.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getOAuthApiKey, type OAuthCredentials } from '@mariozechner/pi-ai/oauth';

const AUTH_PATH = resolve(process.env.PI_AUTH_PATH ?? './auth.json');

type AuthFile = Record<string, OAuthCredentials>;

let cached: { apiKey: string; expiresAtMs: number } | null = null;
let inflight: Promise<string> | null = null;

async function readAuthFile(): Promise<AuthFile> {
  const raw = await readFile(AUTH_PATH, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`auth file at ${AUTH_PATH} must be a JSON object`);
  }
  return parsed as AuthFile;
}

async function writeAuthFile(file: AuthFile): Promise<void> {
  await writeFile(AUTH_PATH, JSON.stringify(file, null, 2), { mode: 0o600 });
}

export async function getApiKey(providerId: string): Promise<string> {
  // Cache the access token until ~60s before its `expires` claim.
  // pi-ai's getOAuthApiKey() will re-refresh past that anyway, but we
  // skip the file read on the hot path while the token is fresh.
  const now = Date.now();
  if (cached && cached.expiresAtMs - now > 60_000) return cached.apiKey;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const file = await readAuthFile();
      const before = file[providerId];
      if (!before) {
        throw new Error(
          `no credentials for provider '${providerId}' in ${AUTH_PATH}. Run \`npx @mariozechner/pi-ai login ${providerId}\` in this directory.`,
        );
      }

      const result = await getOAuthApiKey(providerId, file);
      if (!result) {
        throw new Error(`getOAuthApiKey returned null for ${providerId}`);
      }

      // Persist back if the refresh rotated anything.
      if (
        result.newCredentials.access !== before.access ||
        result.newCredentials.refresh !== before.refresh ||
        result.newCredentials.expires !== before.expires
      ) {
        file[providerId] = result.newCredentials;
        await writeAuthFile(file);
      }

      cached = {
        apiKey: result.apiKey,
        expiresAtMs: Number(result.newCredentials.expires) || now + 60 * 60 * 1000,
      };
      return result.apiKey;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function getAuthPath(): string {
  return AUTH_PATH;
}
