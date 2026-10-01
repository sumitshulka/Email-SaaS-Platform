import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import profileRouter from "./profile";
import adminRouter from "./admin";
import billingRouter from "./billing";
import contactsRouter from "./contacts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(profileRouter);
router.use(billingRouter);
router.use(contactsRouter);
router.use(adminRouter);

export default router;
