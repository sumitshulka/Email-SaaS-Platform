import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import {
  GetAIProviderSettingsResponse,
  TestAIProviderConnectionBody,
  TestAIProviderConnectionResponse,
  UpdateAIProviderSettingsBody,
  UpdateAIProviderSettingsResponse,
} from "@workspace/api-zod";
import { writeAuditLog } from "../lib/audit";
import {
  getAIProviderConfigurationStatus,
  getStoredAIProviderApiKey,
  removeAIProviderConfiguration,
  saveAIProviderConfiguration,
} from "../lib/ai-provider-configuration";
import {
  AIProviderConnectionError,
  listAIProviderModels,
} from "../lib/ai-provider-client";
import { requireSuperadmin } from "../lib/session";

const router: IRouter = Router();

function sendProviderError(
  req: Request,
  res: Response,
  provider: string,
  error: unknown,
): void {
  if (error instanceof AIProviderConnectionError) {
    res.status(error.statusCode).json({
      error: error.message,
      code: "AI_PROVIDER_CONNECTION_FAILED",
    });
    return;
  }

  req.log.error(
    {
      provider,
      errorName: error instanceof Error ? error.name : "UnknownError",
    },
    "AI provider request failed unexpectedly",
  );
  res.status(502).json({
    error: "The provider could not be reached. Try again later.",
    code: "AI_PROVIDER_CONNECTION_FAILED",
  });
}

router.get(
  "/admin/settings/ai-provider",
  requireSuperadmin,
  async (_req, res): Promise<void> => {
    res.json(
      GetAIProviderSettingsResponse.parse(
        await getAIProviderConfigurationStatus(),
      ),
    );
  },
);

router.post(
  "/admin/settings/ai-provider/test",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const parsed = TestAIProviderConnectionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Choose a supported provider and enter a valid API key.",
        code: "INVALID_AI_PROVIDER_SETTINGS",
      });
      return;
    }

    const provider = parsed.data.provider;
    const submittedKey = parsed.data.apiKey?.trim() || null;
    const apiKey =
      submittedKey ?? (await getStoredAIProviderApiKey(provider));
    if (!apiKey) {
      res.status(400).json({
        error:
          "Enter an API key. A saved key can only be reused for the provider currently configured.",
        code: "AI_PROVIDER_API_KEY_REQUIRED",
      });
      return;
    }

    try {
      const models = await listAIProviderModels(provider, apiKey);
      res.json(
        TestAIProviderConnectionResponse.parse({
          provider,
          connected: true,
          models,
          testedAt: new Date().toISOString(),
        }),
      );
    } catch (error) {
      sendProviderError(req, res, provider, error);
    }
  },
);

router.put(
  "/admin/settings/ai-provider",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const parsed = UpdateAIProviderSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Choose a provider and a model returned by its model list.",
        code: "INVALID_AI_PROVIDER_SETTINGS",
      });
      return;
    }

    const provider = parsed.data.provider;
    const submittedKey = parsed.data.apiKey?.trim() || null;
    const apiKey =
      submittedKey ?? (await getStoredAIProviderApiKey(provider));
    if (!apiKey) {
      res.status(400).json({
        error:
          "Enter an API key. A saved key can only be reused for the provider currently configured.",
        code: "AI_PROVIDER_API_KEY_REQUIRED",
      });
      return;
    }

    const selectedModel = parsed.data.selectedModel.trim();
    let models;
    try {
      models = await listAIProviderModels(provider, apiKey);
    } catch (error) {
      sendProviderError(req, res, provider, error);
      return;
    }

    if (!models.some((model) => model.id === selectedModel)) {
      res.status(400).json({
        error:
          "That model is no longer available for this API key. Test the connection and choose an available model.",
        code: "AI_PROVIDER_MODEL_UNAVAILABLE",
      });
      return;
    }

    await saveAIProviderConfiguration({
      provider,
      apiKey,
      selectedModel,
      updatedBy: req.authUser!.id,
    });
    await writeAuditLog({
      actorId: req.authUser!.id,
      action: "ai_provider_configuration.updated",
      entity: "system_configuration",
      entityId: "ai_provider",
      ipAddress: req.ip,
      metadata: {
        provider,
        selectedModel,
        apiKeyChanged: Boolean(submittedKey),
      },
    });

    res.json(
      UpdateAIProviderSettingsResponse.parse(
        await getAIProviderConfigurationStatus(),
      ),
    );
  },
);

router.delete(
  "/admin/settings/ai-provider",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const previous = await getAIProviderConfigurationStatus();
    await removeAIProviderConfiguration(req.authUser!.id);
    await writeAuditLog({
      actorId: req.authUser!.id,
      action: "ai_provider_configuration.removed",
      entity: "system_configuration",
      entityId: "ai_provider",
      ipAddress: req.ip,
      metadata: {
        provider: previous.provider,
        selectedModel: previous.selectedModel,
      },
    });

    res.json(
      GetAIProviderSettingsResponse.parse(
        await getAIProviderConfigurationStatus(),
      ),
    );
  },
);

export default router;
