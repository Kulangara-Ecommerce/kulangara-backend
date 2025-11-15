import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { Role } from '@prisma/client';
import { validateRequest } from '../middleware/validate';
import {
  listUsers,
  updateUserRole,
  updateUserStatus,
  sendEmail,
} from '../controllers/admin.controller';
import {
  getAnalytics,
  getDashboardStats,
  getOrderAnalytics,
} from '../controllers/analytics.controller';
import {
  updateUserRoleSchema,
  updateUserStatusSchema,
  sendEmailSchema,
} from '../validators/admin.validator';

const router = Router();

// All routes require authentication
router.use(authenticate);

// User management routes
router.get('/users', authorize(Role.ADMIN, Role.SUPER_ADMIN), listUsers);
router.put(
  '/users/:id/role',
  authorize(Role.SUPER_ADMIN),
  validateRequest(updateUserRoleSchema),
  updateUserRole
);
router.put(
  '/users/:id/status',
  authorize(Role.ADMIN, Role.SUPER_ADMIN),
  validateRequest(updateUserStatusSchema),
  updateUserStatus
);

// Analytics routes
router.get('/analytics', authorize(Role.ADMIN, Role.SUPER_ADMIN), getAnalytics);
router.get('/analytics/orders', authorize(Role.ADMIN, Role.SUPER_ADMIN), getOrderAnalytics);
router.get('/dashboard', authorize(Role.ADMIN, Role.SUPER_ADMIN), getDashboardStats);

// Email routes
router.post(
  '/emails/send',
  authorize(Role.ADMIN, Role.SUPER_ADMIN),
  validateRequest(sendEmailSchema),
  sendEmail
);

export default router;
