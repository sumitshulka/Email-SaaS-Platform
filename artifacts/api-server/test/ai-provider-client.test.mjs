import assert from "node:assert/strict";
import test from "node:test";
import {
  AIProviderConnectionError,
  listAIProviderModels,
} from "../src/lib/ai-provider-client.ts";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("OpenAI model discovery keeps text-generation models and sends the key in a header", async () => {
  let request;
  const models = await listAIProviderModels(
    "openai",
    "test-openai-secret",
    async (url, init) => {
      request = { url: String(url), init };
      return jsonResponse({
        data: [
          { id: "gpt-4o-mini" },
          { id: "text-embedding-3-large" },
          { id: "o3-mini" },
        ],
        has_more: false,
      });
    },
  );

  assert.deepEqual(models.map((model) => model.id), ["gpt-4o-mini", "o3-mini"]);
  assert.equal(new URL(request.url).searchParams.has("key"), false);
  assert.equal(request.init.headers.Authorization, "Bearer test-openai-secret");
});

test("Anthropic model discovery follows pagination and returns display names", async () => {
  const requests = [];
  const models = await listAIProviderModels(
    "anthropic",
    "test-anthropic-secret",
    async (url, init) => {
      requests.push({ url: String(url), init });
      if (requests.length === 1) {
        return jsonResponse({
          data: [{ id: "claude-sonnet", display_name: "Claude Sonnet" }],
          has_more: true,
          last_id: "claude-sonnet",
        });
      }
      return jsonResponse({
        data: [{ id: "claude-opus", display_name: "Claude Opus" }],
        has_more: false,
        last_id: "claude-opus",
      });
    },
  );

  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[1].url).searchParams.get("after_id"), "claude-sonnet");
  assert.equal(requests[0].init.headers["x-api-key"], "test-anthropic-secret");
  assert.equal(requests[0].init.headers["anthropic-version"], "2023-06-01");
  assert.deepEqual(models.map((model) => model.name), ["Claude Opus", "Claude Sonnet"]);
});

test("Gemini model discovery only returns models that support generateContent", async () => {
  let request;
  const models = await listAIProviderModels(
    "gemini",
    "test-gemini-secret",
    async (url, init) => {
      request = { url: String(url), init };
      return jsonResponse({
        models: [
          {
            name: "models/gemini-2.5-flash",
            displayName: "Gemini 2.5 Flash",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/text-embedding-004",
            displayName: "Text Embedding",
            supportedGenerationMethods: ["embedContent"],
          },
        ],
      });
    },
  );

  assert.deepEqual(models, [
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  ]);
  assert.equal(new URL(request.url).searchParams.has("key"), false);
  assert.equal(request.init.headers["x-goog-api-key"], "test-gemini-secret");
});

test("provider error bodies are not returned to the caller", async () => {
  const secret = "sensitive-api-key-value";
  await assert.rejects(
    listAIProviderModels("openai", secret, async () =>
      jsonResponse({ error: { message: `Rejected ${secret}` } }, 401),
    ),
    (error) => {
      assert.ok(error instanceof AIProviderConnectionError);
      assert.match(error.message, /rejected the API key/i);
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});
