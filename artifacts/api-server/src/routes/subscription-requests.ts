import { Router, type IRouter, type Response } from "express";
import {
  ApproveAdminSubscriptionRequestParams,
  ApproveAdminSubscriptionRequestResponse,
  CreateBasicPlanSupportRequestResponse,
  GetBasicPlanSupportStatusResponse,
  ListAdminSubscriptionRequestsQueryParams,
  ListAdminSubscriptionRequestsResponse,
  RejectAdminSubscriptionRequestBody,
  RejectAdminSubscriptionRequestParams,
  RejectAdminSubscriptionRequestResponse,
} from "@workspace/api-zod";
import { writeAuditLog } from "../lib/audit";
import {
  decideAdminBasicPlanRequest,
  getBasicPlanSupportStatus,
  listAdminBasicPlanRequests,
  submitBasicPlanSupportRequest,
} from "../lib/basic-plan-support";
import { requireSuperadmin, requireUserRole } from "../lib/session";

const router: IRouter = Router();

router.get(
  "/subscriptions/basic-plan-support",
  requireUserRole,
  async (req, res): Promise<void> => {
    const status = await getBasicPlanSupportStatus(req.authUser!.id);
    res.json(GetBasicPlanSupportStatusResponse.parse(status));
  },
);

router.post(
  "/subscriptions/basic-plan-support",
  requireUserRole,
  async (req, res): Promise<void> => {
    const result = await submitBasicPlanSupportRequest(req.authUser!.id);
    if (result.kind === "ineligible") {
      res.status(409).json({
        error: result.status.message,
        code: "BASIC_PLAN_REQUEST_INELIGIBLE",
      });
      return;
    }
    res
      .status(201)
      .json(CreateBasicPlanSupportRequestResponse.parse(result.status));
  },
);

router.get(
  "/admin/subscription-requests",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const parsed = ListAdminSubscriptionRequestsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: "Choose pending requests or all request history.",
        code: "INVALID_INPUT",
      });
      return;
    }
    const result = await listAdminBasicPlanRequests(parsed.data.status);
    res.json(ListAdminSubscriptionRequestsResponse.parse(result));
  },
);

async function resolveAdminRequest(
  requestId: string,
  actorId: string,
  ipAddress: string | undefined,
  decision: "approve" | "reject",
  reason: string | undefined,
  res: Response,
): Promise<void> {
  const result = await decideAdminBasicPlanRequest({
    requestId,
    actorId,
    decision,
    reason,
  });
  if (result.kind !== "resolved" || !result.request) {
    if (result.kind === "not_found") {
      res.status(404).json({
        error: "Subscription request was not found.",
        code: "NOT_FOUND",
      });
    } else if (result.kind === "deadline_passed") {
      res.status(409).json({
        error: "The 72-hour review period has ended. This request will be granted automatically.",
        code: "REQUEST_DEADLINE_PASSED",
      });
    } else if (result.kind === "package_unavailable") {
      res.status(503).json({
        error: "The active Basic package is unavailable. Restore it before processing this request.",
        code: "BASIC_PLAN_UNAVAILABLE",
      });
    } else {
      res.status(409).json({
        error: "This request is no longer pending.",
        code: "REQUEST_NOT_PENDING",
      });
    }
    return;
  }

  await writeAuditLog({
    actorId,
    action:
      decision === "approve"
        ? "subscription_request.basic_plan_approved"
        : "subscription_request.basic_plan_rejected",
    entity: "basic_plan_support_request",
    entityId: requestId,
    ipAddress,
    metadata: {
      userId: result.request.userId,
      milestone: result.request.milestone,
      reason: decision === "reject" ? reason?.trim() : undefined,
      grantStartsAt: result.request.grantStartsAt,
      grantEndsAt: result.request.grantEndsAt,
    },
  });
  res.json(
    (decision === "approve"
      ? ApproveAdminSubscriptionRequestResponse
      : RejectAdminSubscriptionRequestResponse).parse({
      message:
        decision === "approve"
          ? "Basic plan granted for 30 days."
          : "Request rejected; the reason has been sent to the user.",
      request: result.request,
    }),
  );
}

router.post(
  "/admin/subscription-requests/:requestId/approve",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const parsed = ApproveAdminSubscriptionRequestParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({
        error: "Choose a valid subscription request.",
        code: "INVALID_INPUT",
      });
      return;
    }
    await resolveAdminRequest(
      parsed.data.requestId,
      req.authUser!.id,
      req.ip,
      "approve",
      undefined,
      res,
    );
  },
);

router.post(
  "/admin/subscription-requests/:requestId/reject",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const params = RejectAdminSubscriptionRequestParams.safeParse(req.params);
    const body = RejectAdminSubscriptionRequestBody.safeParse(req.body);
    if (!params.success || !body.success || body.data.reason.trim().length < 10) {
      res.status(400).json({
        error: "Enter a clear rejection reason of at least 10 characters.",
        code: "INVALID_INPUT",
      });
      return;
    }
    await resolveAdminRequest(
      params.data.requestId,
      req.authUser!.id,
      req.ip,
      "reject",
      body.data.reason,
      res,
    );
  },
);

export default router;
