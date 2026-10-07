export type AIProviderId = "openai" | "anthropic" | "gemini";

export type AIProviderModel = {
  id: string;
  name: string;
};

type JsonRecord = Record<string, unknown>;
type Fetcher = typeof fetch;

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_MODEL_PAGES = 10;

export class AIProviderConnectionError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 502,
  ) {
    super(message);
    this.name = "AIProviderConnectionError";
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function toModels(value: unknown, idField: string, nameField: string): AIProviderModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): AIProviderModel[] => {
    const record = asRecord(item);
    const id = record?.[idField];
    const name = record?.[nameField];
    if (typeof id !== "string" || !id.trim() || id.length > 200) {
      return [];
    }
    return [{
      id: id.trim(),
      name:
        typeof name === "string" && name.trim()
          ? name.trim().slice(0, 300)
          : id.trim(),
    }];
  });
}

function dedupeAndSort(models: AIProviderModel[]): AIProviderModel[] {
  const unique = new Map<string, AIProviderModel>();
  for (const model of models) {
    if (!unique.has(model.id)) {
      unique.set(model.id, model);
    }
  }
  return [...unique.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

function providerError(status: number): AIProviderConnectionError {
  if (status === 401 || status === 403) {
    return new AIProviderConnectionError(
      "The provider rejected the API key or it does not have permission to list models.",
      400,
    );
  }
  if (status === 429) {
    return new AIProviderConnectionError(
      "The provider rate-limited this request. Wait a moment and try again.",
      502,
    );
  }
  if (status >= 500) {
    return new AIProviderConnectionError(
      "The provider is temporarily unavailable. Try again later.",
      502,
    );
  }
  return new AIProviderConnectionError(
    `The provider rejected the model-list request (HTTP ${status}). Check the API key and try again.`,
    400,
  );
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  fetcher: Fetcher,
): Promise<JsonRecord> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new AIProviderConnectionError(
        "The provider did not respond within 15 seconds. Try again.",
        504,
      );
    }
    throw new AIProviderConnectionError(
      "Could not reach the provider. Check its status and try again.",
      502,
    );
  }

  if (!response.ok) {
    // Provider response bodies are intentionally not forwarded or logged:
    // they can contain request details that should stay server-side.
    throw providerError(response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AIProviderConnectionError(
      "The provider returned an unreadable model list.",
      502,
    );
  }

  const record = asRecord(payload);
  if (!record) {
    throw new AIProviderConnectionError(
      "The provider returned an unexpected model-list response.",
      502,
    );
  }
  return record;
}

async function listOpenAIModels(
  apiKey: string,
  fetcher: Fetcher,
): Promise<AIProviderModel[]> {
  const models: AIProviderModel[] = [];
  let after: string | undefined;

  for (let page = 0; page < MAX_MODEL_PAGES; page += 1) {
    const url = new URL("https://api.openai.com/v1/models");
    url.searchParams.set("limit", "100");
    if (after) {
      url.searchParams.set("after", after);
    }
    const response = await fetchJson(
      url.toString(),
      { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      fetcher,
    );
    const pageModels = toModels(response.data, "id", "id");
    models.push(...pageModels);

    const lastId = response.last_id;
    if (
      response.has_more !== true ||
      typeof lastId !== "string" ||
      !lastId ||
      lastId === after
    ) {
      break;
    }
    after = lastId;
  }

  // The Models API also lists embedding, audio, image, and moderation models.
  // Restrict the setup picker to OpenAI's common text-generation families.
  return dedupeAndSort(
    models.filter((model) =>
      /^(?:gpt(?:-|$)|o\d+(?:-|$)|chatgpt-)/i.test(model.id),
    ),
  );
}

async function listAnthropicModels(
  apiKey: string,
  fetcher: Fetcher,
): Promise<AIProviderModel[]> {
  const models: AIProviderModel[] = [];
  let afterId: string | undefined;

  for (let page = 0; page < MAX_MODEL_PAGES; page += 1) {
    const url = new URL("https://api.anthropic.com/v1/models");
    url.searchParams.set("limit", "100");
    if (afterId) {
      url.searchParams.set("after_id", afterId);
    }
    const response = await fetchJson(
      url.toString(),
      {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        Accept: "application/json",
      },
      fetcher,
    );
    models.push(...toModels(response.data, "id", "display_name"));

    const lastId = response.last_id;
    if (
      response.has_more !== true ||
      typeof lastId !== "string" ||
      !lastId ||
      lastId === afterId
    ) {
      break;
    }
    afterId = lastId;
  }

  return dedupeAndSort(models);
}

async function listGeminiModels(
  apiKey: string,
  fetcher: Fetcher,
): Promise<AIProviderModel[]> {
  const models: AIProviderModel[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_MODEL_PAGES; page += 1) {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("pageSize", "100");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }
    const response = await fetchJson(
      url.toString(),
      { "x-goog-api-key": apiKey, Accept: "application/json" },
      fetcher,
    );
    if (Array.isArray(response.models)) {
      for (const item of response.models) {
        const record = asRecord(item);
        const methods = record?.supportedGenerationMethods;
        if (
          !Array.isArray(methods) ||
          !methods.includes("generateContent")
        ) {
          continue;
        }
        const name = record?.name;
        const id =
          typeof name === "string" ? name.replace(/^models\//, "") : "";
        const displayName = record?.displayName;
        if (id) {
          models.push({
            id: id.slice(0, 200),
            name:
              typeof displayName === "string" && displayName.trim()
                ? displayName.trim().slice(0, 300)
                : id,
          });
        }
      }
    }

    const nextPageToken = response.nextPageToken;
    if (typeof nextPageToken !== "string" || !nextPageToken || nextPageToken === pageToken) {
      break;
    }
    pageToken = nextPageToken;
  }

  return dedupeAndSort(models);
}

export async function listAIProviderModels(
  provider: AIProviderId,
  apiKey: string,
  fetcher: Fetcher = fetch,
): Promise<AIProviderModel[]> {
  const normalizedKey = apiKey.trim();
  if (!normalizedKey) {
    throw new AIProviderConnectionError("Enter a provider API key to continue.", 400);
  }

  switch (provider) {
    case "openai":
      return listOpenAIModels(normalizedKey, fetcher);
    case "anthropic":
      return listAnthropicModels(normalizedKey, fetcher);
    case "gemini":
      return listGeminiModels(normalizedKey, fetcher);
  }
}
