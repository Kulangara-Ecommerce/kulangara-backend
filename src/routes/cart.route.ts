import { Router } from 'express';
import {
  getCart,
  addCartItem,
  updateCartItem,
  removeCartItem,
  clearCart,
} from '../controllers/cart.controller';
import { validateRequest } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import { addCartItemSchema, updateCartItemSchema } from '../validators/cart.validator';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Cart routes
router.get('/', getCart);
router.post('/items', validateRequest(addCartItemSchema), addCartItem);
router.put('/items/:id', validateRequest(updateCartItemSchema), updateCartItem);
router.delete('/items/:id', removeCartItem);
router.delete('/clear', clearCart);

export default router;
