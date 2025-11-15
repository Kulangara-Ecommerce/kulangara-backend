import { Router } from 'express';
import {
  validateCartStock,
  getStockInfo,
  getProductOrderHistory,
} from '../controllers/cart-validation.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// Validate cart stock before checkout
router.post('/validate-cart', authenticate, validateCartStock);

// Get real-time stock information
router.get('/info', getStockInfo);

// Get stock info for a specific product (supports path parameter)
router.get('/info/:productId', getStockInfo);

// Debug: Get recent order history for a product
router.get('/debug/orders/:productId', getProductOrderHistory);

export default router;
