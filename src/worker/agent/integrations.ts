// REST API integrations — persisted in DO storage so the user can wire up
// vendors like DataForSEO once and have the credentials survive hibernation.
// Two records per integration:
//   integration:<id>     → public metadata (no secrets)
//   integration_secret:<id> → the user-supplied credential
// Secrets are read inside the DO at request time, signed onto outbound fetches,
// and never returned to the model.

const INTEGRATION_PREFIX = "integration:";
const INTEGRATION_SECRET_PREFIX = "integration_secret:";

export const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,30}[a-z0-9])?$/;

export type ApiAuthMeta =
  | { kind: "none" }
  | { kind: "bearer" }
  | { kind: "basic" }
  | { kind: "header"; headerName: string };

export type ApiAuthSecret =
  | { kind: "none" }
  | { kind: "bearer"; token: string }
  | { kind: "basic"; username: string; password: string }
  | { kind: "header"; headerName: string; value: string };

export type RestApiIntegration = {
  id: string;
  name: string;
  baseUrl: string;
  description?: string;
  authMeta: ApiAuthMeta;
  createdAt: number;
};

// Serializable bundle used to ship integrations from the parent agent to a
// background worker over DO-to-DO RPC. Each child DO is per-task, so the
// secrets are scoped to a single short-lived workspace and aren't broadcast.
export type IntegrationBundle = {
  record: RestApiIntegration;
  secret: ApiAuthSecret;
};

export async function snapshotIntegrations(
  storage: DurableObjectStorage,
): Promise<IntegrationBundle[]> {
  const records = await listIntegrations(storage);
  const bundles: IntegrationBundle[] = [];
  for (const record of records) {
    const secret = await getIntegrationSecret(storage, record.id);
    if (!secret) continue;
    bundles.push({ record, secret });
  }
  return bundles;
}

export function authHeaders(
  secret: ApiAuthSecret,
  meta: ApiAuthMeta,
): Record<string, string> {
  switch (secret.kind) {
    case "none":
      return {};
    case "bearer":
      return { Authorization: `Bearer ${secret.token}` };
    case "basic":
      return {
        Authorization: `Basic ${btoa(`${secret.username}:${secret.password}`)}`,
      };
    case "header": {
      if (meta.kind !== "header") {
        throw new Error("Header-auth secret stored without a header name");
      }
      return { [meta.headerName]: secret.value };
    }
  }
}

export async function putIntegration(
  storage: DurableObjectStorage,
  record: RestApiIntegration,
  secret: ApiAuthSecret,
): Promise<void> {
  await Promise.all([
    storage.put(`${INTEGRATION_PREFIX}${record.id}`, record),
    storage.put(`${INTEGRATION_SECRET_PREFIX}${record.id}`, secret),
  ]);
}

export async function deleteIntegration(
  storage: DurableObjectStorage,
  id: string,
): Promise<void> {
  await Promise.all([
    storage.delete(`${INTEGRATION_PREFIX}${id}`),
    storage.delete(`${INTEGRATION_SECRET_PREFIX}${id}`),
  ]);
}

export async function listIntegrations(
  storage: DurableObjectStorage,
): Promise<RestApiIntegration[]> {
  const map = await storage.list<RestApiIntegration>({
    prefix: INTEGRATION_PREFIX,
  });
  return [...map.values()];
}

export async function getIntegrationSecret(
  storage: DurableObjectStorage,
  id: string,
): Promise<ApiAuthSecret | null> {
  const secret = await storage.get<ApiAuthSecret>(
    `${INTEGRATION_SECRET_PREFIX}${id}`,
  );
  return secret ?? null;
}
