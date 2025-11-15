import { Router } from 'express';
import {
  getProfile,
  updateProfile,
  deleteAccount,
  changePassword,
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} from '../controllers/user.controller';
import { validateRequest } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import {
  updateProfileSchema,
  changePasswordSchema,
  createAddressSchema,
  updateAddressSchema,
} from '../validators/user.validator';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Profile routes
router.get('/profile', getProfile);
router.put('/profile', validateRequest(updateProfileSchema), updateProfile);
router.delete('/account', deleteAccount);
router.post('/change-password', validateRequest(changePasswordSchema), changePassword);

// Address routes
router.get('/addresses', getAddresses);
router.post('/addresses', validateRequest(createAddressSchema), createAddress);
router.put('/addresses/:id', validateRequest(updateAddressSchema), updateAddress);
router.delete('/addresses/:id', deleteAddress);
router.put('/addresses/:id/default', setDefaultAddress);

export default router;
