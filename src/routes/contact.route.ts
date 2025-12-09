import { Router } from 'express';
import { submitContact, listContactMessages } from '../controllers/contact.controller';
import { validateRequest } from '../middleware/validate';
import { contactSchema } from '../validators/contact.validator';
import { authenticate, authorize } from '../middleware/auth';
import { Role } from '@prisma/client';

const router = Router();

router.post('/', validateRequest(contactSchema), submitContact);

router.get('/', authenticate, authorize(Role.ADMIN, Role.SUPER_ADMIN), listContactMessages);

export default router;

