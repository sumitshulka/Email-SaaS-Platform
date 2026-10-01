import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import profileRouter from "./profile";
import adminRouter from "./admin";
import billingRouter from "./billing";
import sendingRouter from "./sending";
import { contactImportRouter } from "./contacts";

const router: IRouter = Router();
router.use(healthRouter);
router.use(authRouter);
router.use(profileRouter);
router.use(billingRouter);
router.use(contactImportRouter);
router.use(sendingRouter);
router.use(adminRouter);
export default router;
