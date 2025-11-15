import { Router } from 'express';
import { getWishlist, addToWishlist, removeFromWishlist } from '../controllers/wishlist.controller';
import { validateRequest } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import { addToWishlistSchema } from '../validators/wishlist.validator';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Wishlist routes
router.get('/', getWishlist);
router.post('/items', validateRequest(addToWishlistSchema), addToWishlist);
router.delete('/items/:id', removeFromWishlist);

export default router;
