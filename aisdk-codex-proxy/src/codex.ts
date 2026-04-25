import { randomUUID } from 'node:crypto';
import { getAuth } from './auth.js';

const RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
const ORIGINATOR = 'codex_cli_rs';

export async function forwardToCodex(body: string): Promise<Response> {
  const auth = await getAuth();
  return fetch(RESPONSES_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      authorization: `Bearer ${auth.accessToken}`,
      'chatgpt-account-id': auth.accountId,
      'openai-beta': 'responses=experimental',
      originator: ORIGINATOR,
      session_id: randomUUID(),
    },
    body,
  });
}
