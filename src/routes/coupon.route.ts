import { Router } from 'express';
import {
  listCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  validateCoupon,
} from '../controllers/coupon.controller';
import { validateRequest } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { createCouponSchema, updateCouponSchema } from '../validators/coupon.validator';
import { Role } from '@prisma/client';

const router = Router();

// Public routes
router.get('/validate/:code', authenticate, validateCoupon);

// Admin routes
router.get('/admin/coupons', authenticate, authorize(Role.ADMIN), listCoupons);
router.post(
  '/admin/coupons',
  authenticate,
  authorize(Role.ADMIN),
  validateRequest(createCouponSchema),
  createCoupon
);
router.put(
  '/admin/coupons/:id',
  authenticate,
  authorize(Role.ADMIN),
  validateRequest(updateCouponSchema),
  updateCoupon
);
router.delete('/admin/coupons/:id', authenticate, authorize(Role.ADMIN), deleteCoupon);

export default router;
