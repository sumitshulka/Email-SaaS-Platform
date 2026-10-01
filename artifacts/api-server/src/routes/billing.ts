import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateSubscriptionOrderBody,
  CreateSubscriptionPackageBody,
  CreateSubscriptionPackageResponse,
  GetCurrentSubscriptionResponse,
  GetRazorpaySettingsResponse,
  ListAdminSubscriptionPackagesResponse,
  ListAvailableSubscriptionPackagesResponse,
  ReceiveRazorpayWebhookResponse,
  TestRazorpayConnectionResponse,
  UpdateRazorpaySettingsBody,
  UpdateRazorpaySettingsResponse,
  UpdateSubscriptionPackageBody,
  UpdateSubscriptionPackageParams,
  UpdateSubscriptionPackageResponse,
  VerifyRazorpayPaymentBody,
  VerifyRazorpayPaymentResponse,
} from "@workspace/api-zod";
import {
  db,
  paymentsTable,
  razorpayConfigurationTable,
  razorpayWebhookEventsTable,
  subscriptionPackagesTable,
} from "@workspace/db";
import { activateCapturedPayment, getCurrentSubscriptionForUser, serializePackage } from "../lib/billing";
import { writeAuditLog } from "../lib/audit";
import { encryptSecret } from "../lib/security";
import {
  createRazorpayOrder,
  getRazorpayConfiguration,
  getRazorpayPayment,
  RazorpayApiError,
  testRazorpayConnection,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "../lib/razorpay";
import { getPlatformSettings } from "../lib/platform-settings";
import { requireSuperadmin, requireUserRole } from "../lib/session";

const router: IRouter = Router();

function invalidInput(res: Response, message: string): void {
  res.status(400).json({ error: message, code: "INVALID_INPUT" });
}

function webhookEntity(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function webhookText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isSupportedCurrency(currency: string): boolean {
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency });
    return true;
  } catch {
    return false;
  }
}

router.get(
  "/admin/billing/razorpay",
  requireSuperadmin,
  async (_req, res): Promise<void> => {
    const [config] = await db
      .select()
      .from(razorpayConfigurationTable)
      .where(eq(razorpayConfigurationTable.id, "platform"))
      .limit(1);
    res.json(
      GetRazorpaySettingsResponse.parse({
        keyId: config?.keyId ?? null,
        keySecretConfigured: Boolean(config?.keySecretEncrypted),
        webhookSecretConfigured: Boolean(config?.webhookSecretEncrypted),
        updatedAt: config?.updatedAt.toISOString() ?? null,
      }),
    );
  },
);

router.put(
  "/admin/billing/razorpay",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const parsed = UpdateRazorpaySettingsBody.safeParse(req.body);
    if (!parsed.success) {
      invalidInput(res, "Enter a valid Razorpay key ID and credentials.");
      return;
    }

    const [existing] = await db
      .select()
      .from(razorpayConfigurationTable)
      .where(eq(razorpayConfigurationTable.id, "platform"))
      .limit(1);
    const keyId = parsed.data.keyId.trim();
    const keySecret = parsed.data.keySecret?.trim();
    const webhookSecret = parsed.data.webhookSecret?.trim();
    if (!keyId || (!existing && (!keySecret || !webhookSecret))) {
      res.status(400).json({
        error:
          "Enter the Razorpay key secret and webhook secret when setting up the gateway for the first time.",
        code: "RAZORPAY_CREDENTIALS_REQUIRED",
      });
      return;
    }

    const keySecretEncrypted = keySecret
      ? encryptSecret(keySecret)
      : existing?.keySecretEncrypted;
    const webhookSecretEncrypted = webhookSecret
      ? encryptSecret(webhookSecret)
      : existing?.webhookSecretEncrypted;
    if (!keySecretEncrypted || !webhookSecretEncrypted) {
      res.status(400).json({
        error: "Both the Razorpay key secret and webhook secret are required.",
        code: "RAZORPAY_CREDENTIALS_REQUIRED",
      });
      return;
    }

    const now = new Date();
    await db
      .insert(razorpayConfigurationTable)
      .values({
        id: "platform",
        keyId,
        keySecretEncrypted,
        webhookSecretEncrypted,
        updatedBy: req.authUser!.id,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: razorpayConfigurationTable.id,
        set: {
          keyId,
          keySecretEncrypted,
          webhookSecretEncrypted,
          updatedBy: req.authUser!.id,
          updatedAt: now,
        },
      });

    await writeAuditLog({
      actorId: req.authUser!.id,
      action: "razorpay_configuration.updated",
      entity: "razorpay_configuration",
      entityId: "platform",
      ipAddress: req.ip,
      metadata: {
        keyId,
        keySecretChanged: Boolean(keySecret),
        webhookSecretChanged: Boolean(webhookSecret),
      },
    });

    const [saved] = await db
      .select()
      .from(razorpayConfigurationTable)
      .where(eq(razorpayConfigurationTable.id, "platform"))
      .limit(1);
    res.json(
      UpdateRazorpaySettingsResponse.parse({
        keyId: saved!.keyId,
        keySecretConfigured: true,
        webhookSecretConfigured: true,
        updatedAt: saved!.updatedAt.toISOString(),
      }),
    );
  },
);

router.post(
  "/admin/billing/razorpay/test",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    try {
      const config = await getRazorpayConfiguration();
      if (!config) {
        res.status(400).json({
          error: "Save Razorpay credentials before testing the connection.",
          code: "RAZORPAY_NOT_CONFIGURED",
        });
        return;
      }
      await testRazorpayConnection(config);
      res.json(
        TestRazorpayConnectionResponse.parse({
          success: true,
          message: "Razorpay accepted the saved API credentials.",
        }),
      );
    } catch (error) {
      req.log.warn(
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
          providerStatus:
            error instanceof RazorpayApiError ? error.status : undefined,
        },
        "Razorpay connection test failed",
      );
      res.json(
        TestRazorpayConnectionResponse.parse({
          success: false,
          message:
            error instanceof RazorpayApiError
              ? error.message
              : "The saved Razorpay credentials could not be verified.",
        }),
      );
    }
  },
);

router.get(
  "/admin/billing/packages",
  requireSuperadmin,
  async (_req, res): Promise<void> => {
    const packages = await db
      .select()
      .from(subscriptionPackagesTable)
      .orderBy(desc(subscriptionPackagesTable.active), asc(subscriptionPackagesTable.name));
    res.json(
      ListAdminSubscriptionPackagesResponse.parse({
        packages: packages.map(serializePackage),
      }),
    );
  },
);

router.post(
  "/admin/billing/packages",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const parsed = CreateSubscriptionPackageBody.safeParse(req.body);
    if (!parsed.success || !isSupportedCurrency(parsed.data.currency)) {
      invalidInput(res, "Enter a valid package name, price, currency, and term.");
      return;
    }
    const [created] = await db
      .insert(subscriptionPackagesTable)
      .values({
        ...parsed.data,
        createdBy: req.authUser!.id,
        updatedBy: req.authUser!.id,
      })
      .returning();
    await writeAuditLog({
      actorId: req.authUser!.id,
      action: "subscription_package.created",
      entity: "subscription_package",
      entityId: created!.id,
      ipAddress: req.ip,
      metadata: {
        name: created!.name,
        amountMinor: created!.amountMinor,
        currency: created!.currency,
        periodDays: created!.periodDays,
        active: created!.active,
      },
    });
    res.status(201).json(
      CreateSubscriptionPackageResponse.parse(serializePackage(created!)),
    );
  },
);

router.patch(
  "/admin/billing/packages/:packageId",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const params = UpdateSubscriptionPackageParams.safeParse(req.params);
    const parsed = UpdateSubscriptionPackageBody.safeParse(req.body);
    if (
      !params.success ||
      !parsed.success ||
      Object.keys(parsed.data).length === 0 ||
      (parsed.data.currency !== undefined &&
        !isSupportedCurrency(parsed.data.currency))
    ) {
      invalidInput(res, "Enter at least one valid package value to update.");
      return;
    }
    const [updated] = await db
      .update(subscriptionPackagesTable)
      .set({
        ...parsed.data,
        updatedBy: req.authUser!.id,
        updatedAt: new Date(),
      })
      .where(eq(subscriptionPackagesTable.id, params.data.packageId))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Subscription package not found.", code: "NOT_FOUND" });
      return;
    }
    await writeAuditLog({
      actorId: req.authUser!.id,
      action: "subscription_package.updated",
      entity: "subscription_package",
      entityId: updated.id,
      ipAddress: req.ip,
      metadata: parsed.data,
    });
    res.json(
      UpdateSubscriptionPackageResponse.parse(serializePackage(updated)),
    );
  },
);

router.get(
  "/subscriptions/packages",
  requireUserRole,
  async (_req, res): Promise<void> => {
    const settings = await getPlatformSettings();
    const packages =
      settings.packageVisibility === "hidden"
        ? []
        : await db
            .select()
            .from(subscriptionPackagesTable)
            .where(eq(subscriptionPackagesTable.active, true))
            .orderBy(asc(subscriptionPackagesTable.amountMinor), asc(subscriptionPackagesTable.name));
    res.json(
      ListAvailableSubscriptionPackagesResponse.parse({
        packages: packages.map(serializePackage),
      }),
    );
  },
);

router.get(
  "/subscriptions/current",
  requireUserRole,
  async (req, res): Promise<void> => {
    const current = await getCurrentSubscriptionForUser(req.authUser!.id);
    res.json(GetCurrentSubscriptionResponse.parse(current));
  },
);

router.post(
  "/subscriptions/orders",
  requireUserRole,
  async (req, res): Promise<void> => {
    const parsed = CreateSubscriptionOrderBody.safeParse(req.body);
    if (!parsed.success) {
      invalidInput(res, "Choose a valid subscription package.");
      return;
    }
    if (!req.authUser!.emailVerified) {
      res.status(403).json({
        error: "Verify your email before purchasing a subscription.",
        code: "EMAIL_VERIFICATION_REQUIRED",
      });
      return;
    }

    const [pkg] = await db
      .select()
      .from(subscriptionPackagesTable)
      .where(
        and(
          eq(subscriptionPackagesTable.id, parsed.data.packageId),
          eq(subscriptionPackagesTable.active, true),
        ),
      )
      .limit(1);
    if (!pkg) {
      res.status(404).json({
        error: "That package is not available for purchase.",
        code: "PACKAGE_NOT_AVAILABLE",
      });
      return;
    }

    const config = await getRazorpayConfiguration();
    if (!config) {
      res.status(503).json({
        error: "Razorpay is not configured yet. Contact the platform administrator.",
        code: "RAZORPAY_NOT_CONFIGURED",
      });
      return;
    }

    const [payment] = await db
      .insert(paymentsTable)
      .values({
        userId: req.authUser!.id,
        packageId: pkg.id,
        receipt: `mf_${randomUUID().replaceAll("-", "")}`,
        amountMinor: pkg.amountMinor,
        currency: pkg.currency,
        status: "created",
      })
      .returning();
    try {
      const order = await createRazorpayOrder(config, {
        amount: payment!.amountMinor,
        currency: payment!.currency,
        receipt: payment!.receipt,
        notes: {
          mailflow_payment_id: payment!.id,
          mailflow_user_id: payment!.userId,
          mailflow_package_id: payment!.packageId,
        },
      });
      if (
        order.amount !== payment!.amountMinor ||
        order.currency !== payment!.currency ||
        !order.id
      ) {
        await db
          .update(paymentsTable)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(paymentsTable.id, payment!.id));
        res.status(502).json({
          error: "Razorpay returned an order that did not match the package price.",
          code: "RAZORPAY_ORDER_MISMATCH",
        });
        return;
      }
      await db
        .update(paymentsTable)
        .set({ razorpayOrderId: order.id, updatedAt: new Date() })
        .where(eq(paymentsTable.id, payment!.id));
      res.status(201).json({
        paymentId: payment!.id,
        orderId: order.id,
        amountMinor: payment!.amountMinor,
        currency: payment!.currency,
        keyId: config.keyId,
        packageName: pkg.name,
        customerName: `${req.authUser!.firstName} ${req.authUser!.lastName}`.trim(),
        customerEmail: req.authUser!.email,
      });
    } catch (error) {
      await db
        .update(paymentsTable)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(paymentsTable.id, payment!.id));
      req.log.warn(
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
          providerStatus:
            error instanceof RazorpayApiError ? error.status : undefined,
        },
        "Razorpay order creation failed",
      );
      res.status(502).json({
        error:
          error instanceof RazorpayApiError
            ? error.message
            : "Razorpay could not create the payment order.",
        code: "RAZORPAY_ORDER_FAILED",
      });
    }
  },
);

router.post(
  "/subscriptions/verify",
  requireUserRole,
  async (req, res): Promise<void> => {
    const parsed = VerifyRazorpayPaymentBody.safeParse(req.body);
    if (!parsed.success) {
      invalidInput(res, "The Razorpay payment response is incomplete.");
      return;
    }
    const [payment] = await db
      .select()
      .from(paymentsTable)
      .where(
        and(
          eq(paymentsTable.id, parsed.data.paymentId),
          eq(paymentsTable.userId, req.authUser!.id),
          eq(paymentsTable.razorpayOrderId, parsed.data.razorpayOrderId),
        ),
      )
      .limit(1);
    if (!payment) {
      res.status(404).json({
        error: "This payment order does not belong to your account.",
        code: "PAYMENT_NOT_FOUND",
      });
      return;
    }
    const config = await getRazorpayConfiguration();
    if (!config) {
      res.status(503).json({
        error: "Razorpay is not configured. Contact the platform administrator.",
        code: "RAZORPAY_NOT_CONFIGURED",
      });
      return;
    }
    if (
      !verifyCheckoutSignature(
        config.keySecret,
        payment.razorpayOrderId!,
        parsed.data.razorpayPaymentId,
        parsed.data.razorpaySignature,
      )
    ) {
      res.status(400).json({
        error: "The Razorpay payment signature could not be verified.",
        code: "INVALID_PAYMENT_SIGNATURE",
      });
      return;
    }

    try {
      const providerPayment = await getRazorpayPayment(
        config,
        parsed.data.razorpayPaymentId,
      );
      if (
        providerPayment.id !== parsed.data.razorpayPaymentId ||
        providerPayment.order_id !== payment.razorpayOrderId ||
        providerPayment.amount !== payment.amountMinor ||
        providerPayment.currency !== payment.currency
      ) {
        res.status(400).json({
          error: "Razorpay payment details did not match the saved order.",
          code: "PAYMENT_DETAILS_MISMATCH",
        });
        return;
      }
      if (providerPayment.status === "captured" || providerPayment.captured) {
        const subscription = await activateCapturedPayment({
          paymentId: payment.id,
          razorpayOrderId: payment.razorpayOrderId!,
          razorpayPaymentId: providerPayment.id,
          amountMinor: providerPayment.amount,
          currency: providerPayment.currency,
        });
        const startsInFuture = new Date(subscription.startsAt) > new Date();
        res.json(
          VerifyRazorpayPaymentResponse.parse({
            status: "active",
            message: startsInFuture
              ? `Payment verified. ${subscription.package.name} starts on ${new Date(subscription.startsAt).toLocaleDateString()} after your current term ends.`
              : "Payment verified. Your subscription is active.",
            subscription,
          }),
        );
        return;
      }
      if (providerPayment.status === "authorized") {
        await db
          .update(paymentsTable)
          .set({
            status: "authorized",
            updatedAt: new Date(),
          })
          .where(eq(paymentsTable.id, payment.id));
      }
      res.json(
        VerifyRazorpayPaymentResponse.parse({
          status: "pending",
          message:
            providerPayment.status === "failed"
              ? "This payment attempt failed and no subscription was activated. You can try checkout again with another payment method."
              : "Razorpay has not confirmed a captured payment yet. Your package will activate after capture is confirmed.",
          subscription: null,
        }),
      );
    } catch (error) {
      req.log.warn(
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
          providerStatus:
            error instanceof RazorpayApiError ? error.status : undefined,
        },
        "Razorpay payment confirmation could not be completed",
      );
      res.status(502).json({
        error:
          "Razorpay could not confirm this payment yet. The signed webhook will still update the subscription after capture.",
        code: "RAZORPAY_CONFIRMATION_PENDING",
      });
    }
  },
);

router.post(
  "/webhooks/razorpay",
  async (req: Request, res: Response): Promise<void> => {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const signature = req.header("x-razorpay-signature");
    if (!rawBody || !signature) {
      res.status(400).json({
        error: "A raw request body and Razorpay signature are required.",
        code: "WEBHOOK_SIGNATURE_REQUIRED",
      });
      return;
    }

    let config;
    try {
      config = await getRazorpayConfiguration();
    } catch (error) {
      req.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Razorpay webhook configuration could not be decrypted",
      );
      res.status(500).json({ error: "Webhook configuration is unavailable." });
      return;
    }
    if (!config) {
      res.status(503).json({
        error: "Razorpay webhook verification is not configured.",
        code: "RAZORPAY_NOT_CONFIGURED",
      });
      return;
    }
    if (!verifyWebhookSignature(config.webhookSecret, rawBody, signature)) {
      res.status(400).json({
        error: "The Razorpay webhook signature is invalid.",
        code: "INVALID_WEBHOOK_SIGNATURE",
      });
      return;
    }

    const body = webhookEntity(req.body) ?? {};
    const eventType = webhookText(body.event)?.slice(0, 100) ?? "unknown";
    const payload = webhookEntity(body.payload) ?? {};
    const orderWrapper = webhookEntity(payload.order);
    const paymentWrapper = webhookEntity(payload.payment);
    const order = webhookEntity(orderWrapper?.entity);
    const providerPayment = webhookEntity(paymentWrapper?.entity);
    const providerOrderId =
      webhookText(order?.id) ?? webhookText(providerPayment?.order_id);
    const providerPaymentId = webhookText(providerPayment?.id);
    const bodySha256 = createHash("sha256").update(rawBody).digest("hex");
    const providerEventId = req.header("x-razorpay-event-id");
    if (providerEventId && providerEventId.length > 128) {
      res.status(400).json({
        error: "The Razorpay event ID is too long.",
        code: "INVALID_WEBHOOK_EVENT_ID",
      });
      return;
    }
    const eventId = providerEventId || bodySha256;

    const [newEvent] = await db
      .insert(razorpayWebhookEventsTable)
      .values({
        eventId,
        eventType,
        razorpayOrderId: providerOrderId,
        razorpayPaymentId: providerPaymentId,
        bodySha256,
      })
      .onConflictDoNothing()
      .returning({ id: razorpayWebhookEventsTable.id });
    if (!newEvent) {
      const [existingEvent] = await db
        .select()
        .from(razorpayWebhookEventsTable)
        .where(eq(razorpayWebhookEventsTable.eventId, eventId))
        .limit(1);
      if (existingEvent?.bodySha256 !== bodySha256) {
        req.log.warn(
          { eventId },
          "Razorpay reused an event ID with a different payload",
        );
        res.status(400).json({
          error: "The webhook event ID did not match its saved payload.",
          code: "WEBHOOK_EVENT_MISMATCH",
        });
        return;
      }
      if (existingEvent?.processedAt) {
        res.json(ReceiveRazorpayWebhookResponse.parse({ message: "Already processed." }));
        return;
      }
    }

    if (
      eventType !== "order.paid" &&
      eventType !== "payment.captured"
    ) {
      await db
        .update(razorpayWebhookEventsTable)
        .set({ processedAt: new Date() })
        .where(eq(razorpayWebhookEventsTable.eventId, eventId));
      res.json(ReceiveRazorpayWebhookResponse.parse({ message: "Event acknowledged." }));
      return;
    }

    const isCaptured =
      providerPayment?.status === "captured" || providerPayment?.captured === true;
    const amount =
      typeof providerPayment?.amount === "number"
        ? providerPayment.amount
        : typeof order?.amount === "number"
          ? order.amount
          : null;
    const currency =
      webhookText(providerPayment?.currency) ?? webhookText(order?.currency);
    const isPaidOrder =
      eventType !== "order.paid" ||
      (order?.status === "paid" &&
        typeof order.amount === "number" &&
        order.amount === amount &&
        webhookText(order.currency) === currency);
    if (
      !providerOrderId ||
      !providerPaymentId ||
      amount === null ||
      !currency ||
      !isCaptured ||
      !isPaidOrder
    ) {
      await db
        .update(razorpayWebhookEventsTable)
        .set({ processedAt: new Date() })
        .where(eq(razorpayWebhookEventsTable.eventId, eventId));
      res.json(ReceiveRazorpayWebhookResponse.parse({ message: "Event acknowledged." }));
      return;
    }

    const [payment] = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.razorpayOrderId, providerOrderId))
      .limit(1);
    if (!payment) {
      await db
        .update(razorpayWebhookEventsTable)
        .set({ processedAt: new Date() })
        .where(eq(razorpayWebhookEventsTable.eventId, eventId));
      res.json(ReceiveRazorpayWebhookResponse.parse({ message: "Unmatched event acknowledged." }));
      return;
    }
    if (payment.amountMinor !== amount || payment.currency !== currency) {
      req.log.error(
        { internalPaymentId: payment.id, providerOrderId },
        "Razorpay webhook amount did not match the saved order",
      );
      await db
        .update(razorpayWebhookEventsTable)
        .set({ processedAt: new Date() })
        .where(eq(razorpayWebhookEventsTable.eventId, eventId));
      res.json(ReceiveRazorpayWebhookResponse.parse({ message: "Mismatched event acknowledged." }));
      return;
    }

    try {
      await activateCapturedPayment({
        paymentId: payment.id,
        razorpayOrderId: providerOrderId,
        razorpayPaymentId: providerPaymentId,
        amountMinor: amount,
        currency,
      });
      await db
        .update(razorpayWebhookEventsTable)
        .set({ processedAt: new Date() })
        .where(eq(razorpayWebhookEventsTable.eventId, eventId));
      res.json(ReceiveRazorpayWebhookResponse.parse({ message: "Payment captured." }));
    } catch (error) {
      req.log.error(
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
          internalPaymentId: payment.id,
          providerOrderId,
        },
        "Razorpay webhook payment processing failed",
      );
      res.status(500).json({
        error: "The payment event could not be processed yet.",
        code: "WEBHOOK_PROCESSING_FAILED",
      });
    }
  },
);

export default router;