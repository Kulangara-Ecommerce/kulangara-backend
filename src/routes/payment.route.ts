import { Router } from 'express';
import {
  createRazorpayOrder,
  createRazorpayOrderFromCart,
  verifyPayment,
  verifyPaymentAndCreateOrder,
  handleWebhook,
} from '../controllers/payment.controller';
import { validateRequest } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import {
  createRazorpayOrderSchema,
  createRazorpayOrderFromCartSchema,
  verifyPaymentSchema,
  verifyPaymentWithCartSchema,
} from '../validators/payment.validator';

const router = Router();

router.post('/webhook', handleWebhook);

router.use(authenticate);

// Create Razorpay order (legacy - creates database order first)
router.post('/create-order', validateRequest(createRazorpayOrderSchema), createRazorpayOrder);

// Create Razorpay order from cart (new - no database order created)
router.post(
  '/create-cart-order',
  validateRequest(createRazorpayOrderFromCartSchema),
  createRazorpayOrderFromCart
);

// Verify payment (legacy)
router.post('/verify', validateRequest(verifyPaymentSchema), verifyPayment);

// Verify payment and create order from cart (new)
router.post(
  '/verify-and-create',
  validateRequest(verifyPaymentWithCartSchema),
  verifyPaymentAndCreateOrder
);

export default router;
