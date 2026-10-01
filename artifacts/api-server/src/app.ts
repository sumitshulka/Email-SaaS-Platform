import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
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
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(cookieParser());
app.use(enforceSameOrigin);
app.use(loadSession);
app.use(enforcePlatformMaintenance);

app.use("/api", router);

app.use(
  (
    error: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Unhandled API error",
    );
    if (res.headersSent) return;
    res.status(500).json({
      error: "The request could not be completed.",
      code: "INTERNAL_ERROR",
    });
  },
);

export default app;
