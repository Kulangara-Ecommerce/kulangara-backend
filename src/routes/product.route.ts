import { Router } from 'express';
import {
  listProducts,
  listProductsAdmin,
  getFeaturedProducts,
  searchProducts,
  getProductById,
  getProductBySlug,
  createProduct,
  updateProduct,
  deleteProduct,
  uploadProductImages,
  deleteProductImage,
  getProductReviews,
  createProductReview,
  updateProductReview,
  deleteProductReview,
  getProductImageUploadUrls,
  createProductVariant,
  createProductVariants,
  updateProductVariant,
  deleteProductVariant,
} from '../controllers/product.controller';
import { validateRequest } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import {
  createProductSchema,
  updateProductSchema,
  createReviewSchema,
  updateReviewSchema,
  createVariantSchema,
  updateVariantSchema,
  createVariantBulkSchema,
} from '../validators/product.validator';
import { Role } from '@prisma/client';

const router = Router();

// Public routes - specific endpoints first
router.get('/list', listProducts);
router.get('/featured', getFeaturedProducts);
router.get('/search', searchProducts);
router.get('/slug/:slug', getProductBySlug);
router.get('/:id/reviews', getProductReviews);
router.get('/:id', getProductById);

// Protected routes
router.use(authenticate);

// Admin only routes
router.get('/admin/list', authorize(Role.ADMIN), listProductsAdmin);
router.post('/', authorize(Role.ADMIN), validateRequest(createProductSchema), createProduct);
router.put('/:id', authorize(Role.ADMIN), validateRequest(updateProductSchema), updateProduct);

// Image upload routes (admin only)
router.post('/:id/images/upload-urls', authorize(Role.ADMIN), getProductImageUploadUrls);
router.post('/:id/images', authorize(Role.ADMIN), uploadProductImages);
router.delete('/:id/images/:imageId', authorize(Role.ADMIN), deleteProductImage);

// Variant routes (admin only)
router.post(
  '/:id/variants',
  authorize(Role.ADMIN),
  validateRequest(createVariantSchema),
  createProductVariant
);
router.post(
  '/:id/variants/bulk',
  authorize(Role.ADMIN),
  validateRequest(createVariantBulkSchema),
  createProductVariants
);
router.put(
  '/:id/variants/:variantId',
  authorize(Role.ADMIN),
  validateRequest(updateVariantSchema),
  updateProductVariant
);
router.delete('/:id/variants/:variantId', authorize(Role.ADMIN), deleteProductVariant);

// Super Admin only routes
router.delete('/:id', authorize(Role.SUPER_ADMIN), deleteProduct);

// User routes (requires authentication)
router.post('/:id/reviews', validateRequest(createReviewSchema), createProductReview);
router.put('/:id/reviews/:reviewId', validateRequest(updateReviewSchema), updateProductReview);
router.delete('/:id/reviews/:reviewId', deleteProductReview);

export default router;
