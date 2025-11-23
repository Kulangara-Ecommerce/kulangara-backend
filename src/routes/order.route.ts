import { Router } from 'express';
import {
  listOrders,
  getOrderById,
  createOrder,
  cancelOrder,
  trackOrder,
  listAllOrders,
  updateOrderStatus,
} from '../controllers/order.controller';
import { updatePaymentStatus } from '../controllers/payment.controller';
import { authenticate, authorize } from '../middleware/auth';
import { validateRequest } from '../middleware/validate';
import { createOrderSchema, updateOrderStatusSchema } from '../validators/order.validator';
import { updatePaymentStatusSchema } from '../validators/payment.validator';
import { Role } from '@prisma/client';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Customer routes
router.get('/list', listOrders);
router.get('/:id', getOrderById);
router.post('/', validateRequest(createOrderSchema), createOrder);
router.post('/:id/cancel', cancelOrder);
router.get('/:id/track', trackOrder);

// Admin routes
router.get(
  '/admin/list',
  authorize(Role.DELIVERY_PARTNER, Role.ADMIN, Role.SUPER_ADMIN),
  listAllOrders
);
router.put(
  '/admin/:id/status',
  authorize(Role.DELIVERY_PARTNER, Role.ADMIN, Role.SUPER_ADMIN),
  validateRequest(updateOrderStatusSchema),
  updateOrderStatus
);
router.put(
  '/admin/:id/payment-status',
  authorize(Role.ADMIN, Role.SUPER_ADMIN),
  validateRequest(updatePaymentStatusSchema),
  updatePaymentStatus
);

export default router;
