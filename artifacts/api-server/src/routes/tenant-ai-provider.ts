import { Router, type IRouter, type Request, type Response } from "express";
import {
  DeleteTenantAIProviderSettingsResponse,
  GetTenantAIProviderSettingsResponse,
  TestTenantAIProviderConnectionBody,
  TestTenantAIProviderConnectionResponse,
  UpdateTenantAIProviderSettingsBody,
  UpdateTenantAIProviderSettingsResponse,
} from "@workspace/api-zod";
import { writeAuditLog } from "../lib/audit";
import { AIProviderConnectionError, listAIProviderModels } from "../lib/ai-provider-client";
import {
  getStoredTenantAIProviderConfiguration,
  getTenantAIProviderConfigurationStatus,
  removeTenantAIProviderConfiguration,
  saveTenantAIProviderConfiguration,
} from "../lib/tenant-ai-provider-configuration";
import { requirePackageFeature } from "../lib/package-feature-access";
import { requireUserRole } from "../lib/session";

const router: IRouter = Router();

function providerError(req: Request, res: Response, error: unknown): void {
  if (error instanceof AIProviderConnectionError) {
    res.status(error.statusCode).json({
      error: error.message,
      code: "AI_PROVIDER_CONNECTION_FAILED",
    });
    return;
  }
  req.log.error(
    { errorName: error instanceof Error ? error.name : "UnknownError" },
    "Tenant AI provider request failed unexpectedly",
  );
  res.status(502).json({
    error: "The provider could not be reached. Try again later.",
    code: "AI_PROVIDER_CONNECTION_FAILED",
  });
}

router.get(
  "/settings/ai-provider",
  requireUserRole,
  async (req, res): Promise<void> => {
    res.json(
      GetTenantAIProviderSettingsResponse.parse(
        await getTenantAIProviderConfigurationStatus(req.authUser!.id),
      ),
    );
  },
);

router.post(
  "/settings/ai-provider/test",
  requireUserRole,
  requirePackageFeature("byokAiEnabled"),
  async (req, res): Promise<void> => {
    const parsed = TestTenantAIProviderConnectionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Choose a supported provider and enter a valid API key.",
        code: "INVALID_AI_PROVIDER_SETTINGS",
      });
      return;
    }

    const userId = req.authUser!.id;
    const submittedKey = parsed.data.apiKey?.trim() || null;
    const saved = submittedKey
      ? null
      : await getStoredTenantAIProviderConfiguration(userId);
    const apiKey =
      submittedKey ??
      (saved?.provider === parsed.data.provider ? saved.apiKey : null);
    if (!apiKey) {
      res.status(400).json({
        error:
          "Enter an API key. A saved key can only be reused for its current provider.",
        code: "AI_PROVIDER_API_KEY_REQUIRED",
      });
      return;
    }

    try {
      const models = await listAIProviderModels(parsed.data.provider, apiKey);
      res.json(
        TestTenantAIProviderConnectionResponse.parse({
          provider: parsed.data.provider,
          connected: true,
          models,
          testedAt: new Date().toISOString(),
        }),
      );
    } catch (error) {
      providerError(req, res, error);
    }
  },
);

router.put(
  "/settings/ai-provider",
  requireUserRole,
  requirePackageFeature("byokAiEnabled"),
  async (req, res): Promise<void> => {
    const parsed = UpdateTenantAIProviderSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Choose a supported provider and a model returned by its model list.",
        code: "INVALID_AI_PROVIDER_SETTINGS",
      });
      return;
    }

    const userId = req.authUser!.id;
    const submittedKey = parsed.data.apiKey?.trim() || null;
    const saved = submittedKey
      ? null
      : await getStoredTenantAIProviderConfiguration(userId);
    const apiKey =
      submittedKey ??
      (saved?.provider === parsed.data.provider ? saved.apiKey : null);
    if (!apiKey) {
      res.status(400).json({
        error:
          "Enter an API key. A saved key can only be reused for its current provider.",
        code: "AI_PROVIDER_API_KEY_REQUIRED",
      });
      return;
    }

    let models;
    try {
      models = await listAIProviderModels(parsed.data.provider, apiKey);
    } catch (error) {
      providerError(req, res, error);
      return;
    }
    if (!models.some((model) => model.id === parsed.data.selectedModel.trim())) {
      res.status(400).json({
        error:
          "That model is not available for this API key. Test the connection and choose an available model.",
        code: "AI_PROVIDER_MODEL_UNAVAILABLE",
      });
      return;
    }

    await saveTenantAIProviderConfiguration({
      userId,
      provider: parsed.data.provider,
      apiKey,
      selectedModel: parsed.data.selectedModel.trim(),
    });
    try {
      await writeAuditLog({
        actorId: userId,
        action: "tenant_ai_provider_configuration.updated",
        entity: "tenant_ai_provider_configuration",
        entityId: userId,
        ipAddress: req.ip,
        metadata: {
          provider: parsed.data.provider,
          selectedModel: parsed.data.selectedModel.trim(),
          apiKeyChanged: Boolean(submittedKey),
        },
      });
    } catch {
      req.log.error(
        { provider: parsed.data.provider, model: parsed.data.selectedModel.trim() },
        "Tenant AI provider audit could not be recorded",
      );
    }
    res.json(
      UpdateTenantAIProviderSettingsResponse.parse(
        await getTenantAIProviderConfigurationStatus(userId),
      ),
    );
  },
);

router.delete(
  "/settings/ai-provider",
  requireUserRole,
  async (req, res): Promise<void> => {
    const userId = req.authUser!.id;
    const previous = await getTenantAIProviderConfigurationStatus(userId);
    await removeTenantAIProviderConfiguration(userId);
    try {
      await writeAuditLog({
        actorId: userId,
        action: "tenant_ai_provider_configuration.removed",
        entity: "tenant_ai_provider_configuration",
        entityId: userId,
        ipAddress: req.ip,
        metadata: {
          provider: previous.provider,
          selectedModel: previous.selectedModel,
        },
      });
    } catch {
      req.log.error(
        { provider: previous.provider, model: previous.selectedModel },
        "Tenant AI provider audit could not be recorded",
      );
    }
    res.json(
      DeleteTenantAIProviderSettingsResponse.parse(
        await getTenantAIProviderConfigurationStatus(userId),
      ),
    );
  },
);

export default router;
