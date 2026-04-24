import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const REFRESH_LEEWAY_MS = 60_000;

const AUTH_PATH = process.env.CODEX_AUTH_PATH ?? join(homedir(), '.codex', 'auth.json');

type Tokens = {
  id_token: string;
  access_token: string;
  refresh_token: string;
  account_id?: string;
};

type AuthFile = {
  openai_api_key?: string;
  tokens?: Tokens;
  last_refresh?: string;
};

export type ResolvedAuth = {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  expiresAtMs: number;
};

let cached: ResolvedAuth | null = null;
let inflight: Promise<ResolvedAuth> | null = null;

function decodeJwt(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  const payload = parts[1];
  if (!payload) throw new Error('invalid jwt');
  const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function jwtExpiryMs(jwt: string): number {
  try {
    const claims = decodeJwt(jwt);
    if (typeof claims.exp === 'number') return claims.exp * 1000;
  } catch {}
  return Date.now() + 60 * 60 * 1000;
}

function extractAccountId(tokens: Tokens): string {
  if (tokens.account_id) return tokens.account_id;
  const claims = decodeJwt(tokens.id_token);
  const candidates = [
    claims['https://chatgpt.com/account_id'],
    claims['chatgpt_account_id'],
    claims['account_id'],
    claims['sub'],
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c) return c;
  }
  throw new Error('could not extract account_id from id_token');
}

async function readAuthFile(): Promise<AuthFile> {
  const raw = await readFile(AUTH_PATH, 'utf8');
  return JSON.parse(raw) as AuthFile;
}

async function writeAuthFile(next: AuthFile): Promise<void> {
  await writeFile(AUTH_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
}

async function refresh(refreshToken: string): Promise<ResolvedAuth> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`token refresh failed: ${res.status} ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token: string;
    expires_in?: number;
  };

  const file = await readAuthFile();
  const nextTokens: Tokens = {
    id_token: json.id_token,
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? refreshToken,
    account_id: file.tokens?.account_id,
  };
  await writeAuthFile({
    ...file,
    tokens: nextTokens,
    last_refresh: new Date().toISOString(),
  });

  return {
    accessToken: nextTokens.access_token,
    refreshToken: nextTokens.refresh_token,
    accountId: extractAccountId(nextTokens),
    expiresAtMs: jwtExpiryMs(nextTokens.access_token),
  };
}

async function loadFromFile(): Promise<ResolvedAuth> {
  const file = await readAuthFile();
  if (!file.tokens) throw new Error(`no tokens in ${AUTH_PATH} — run \`codex login\` first`);
  return {
    accessToken: file.tokens.access_token,
    refreshToken: file.tokens.refresh_token,
    accountId: extractAccountId(file.tokens),
    expiresAtMs: jwtExpiryMs(file.tokens.access_token),
  };
}

export async function getAuth(): Promise<ResolvedAuth> {
  const now = Date.now();
  if (cached && cached.expiresAtMs - now > REFRESH_LEEWAY_MS) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      if (!cached) cached = await loadFromFile();
      if (cached.expiresAtMs - Date.now() <= REFRESH_LEEWAY_MS) {
        cached = await refresh(cached.refreshToken);
      }
      return cached;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
