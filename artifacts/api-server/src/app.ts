import express, { type Express, type Request } from "express";
import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  describeApiError,
  sanitizeDiagnosticPath,
  storeApiErrorDiagnostic,
} from "./lib/api-error-diagnostics";
import { shouldCaptureApiErrorDiagnostics } from "./lib/platform-settings";
import {
  enforcePlatformMaintenance,
  enforceSameOrigin,
  loadSession,
} from "./lib/session";

const app: Express = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  "/api/sending/reports/import",
  express.json({ limit: "7mb" }),
);
app.use("/api/campaigns", express.json({ limit: "16mb" }));
app.use(
  express.json({
    limit: "1mb",
    verify(req, _res, body) {
      if ((req as Request).originalUrl.split("?")[0] === "/api/webhooks/razorpay") {
        (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(body);
      }
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(cookieParser());
app.use(enforceSameOrigin);
app.use(loadSession);
app.use(enforcePlatformMaintenance);

app.use("/api", router);

app.use(
  async (
    error: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ): Promise<void> => {
    const incidentId = randomUUID();
    const path = sanitizeDiagnosticPath(req.originalUrl.split("?")[0] ?? req.path);
    const diagnosticsEnabled = shouldCaptureApiErrorDiagnostics();
    const details = diagnosticsEnabled ? describeApiError(error) : null;
    req.log.error(
      {
        incidentId,
        errorName: details?.errorName ?? (error instanceof Error ? error.name : "UnknownError"),
        ...(details ?? {}),
        ...(diagnosticsEnabled ? { method: req.method, path, statusCode: 500 } : {}),
      },
      diagnosticsEnabled ? "Unhandled API error with diagnostics enabled" : "Unhandled API error",
    );
    if (details) {
      try {
        await storeApiErrorDiagnostic({
          id: incidentId,
          method: req.method,
          path,
          statusCode: 500,
          details,
        });
      } catch (diagnosticError) {
        req.log.error(
          {
            incidentId,
            captureErrorName:
              diagnosticError instanceof Error ? diagnosticError.name : "UnknownError",
          },
          "API error diagnostic could not be stored",
        );
      }
    }
    if (res.headersSent) return;
    res.setHeader("X-Error-Id", incidentId);
    const bodyParserError = error && typeof error === "object" ? error as { type?: unknown } : null;
    if (bodyParserError?.type === "entity.too.large") {
      res.status(413).json({
        error: req.path === "/api/campaigns/attachments/upload"
          ? "PDF uploads are limited to 5 MB; the production reverse proxy must allow at least 6 MB."
          : "This request exceeds the allowed size for this endpoint.",
        code: "PAYLOAD_TOO_LARGE",
      });
      return;
    }
    res.status(500).json({
      error: "The request could not be completed.",
      code: "INTERNAL_ERROR",
      incidentId,
    });
  },
);

export default app;
