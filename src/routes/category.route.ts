import { Router } from 'express';
import {
  listCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../controllers/category.controller';
import { validateRequest } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { createCategorySchema, updateCategorySchema } from '../validators/category.validator';
import { Role } from '@prisma/client';

const router = Router();

// Public routes
router.get('/', listCategories);
router.get('/:id', getCategoryById);

// Admin only routes
router.post(
  '/',
  authenticate,
  authorize(Role.ADMIN),
  validateRequest(createCategorySchema),
  createCategory
);
router.put(
  '/:id',
  authenticate,
  authorize(Role.ADMIN),
  validateRequest(updateCategorySchema),
  updateCategory
);

// Super Admin only routes
router.delete('/:id', authenticate, authorize(Role.SUPER_ADMIN), deleteCategory);

export default router;
