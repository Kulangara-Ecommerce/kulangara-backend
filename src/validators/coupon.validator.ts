import { z } from 'zod';

const DiscountTypeEnum = z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING']);

export const createCouponSchema = z.object({
  body: z.object({
    code: z.string().min(3).max(20).toUpperCase(),
    name: z.string().min(3).max(100),
    description: z.string().max(500).optional(),
    type: DiscountTypeEnum,
    value: z.number().positive(),
    maxDiscount: z.number().positive().optional(),
    minOrderValue: z.number().positive().optional(),
    usageLimit: z.number().int().positive().optional(),
    userUsageLimit: z.number().int().positive().optional(),
    validFrom: z.string().datetime(),
    validUntil: z.string().datetime(),
    isActive: z.boolean().optional(),
  }),
});

export const updateCouponSchema = z.object({
  body: z.object({
    name: z.string().min(3).max(100).optional(),
    description: z.string().max(500).optional(),
    type: DiscountTypeEnum.optional(),
    value: z.number().positive().optional(),
    maxDiscount: z.number().positive().optional(),
    minOrderValue: z.number().positive().optional(),
    usageLimit: z.number().int().positive().optional(),
    userUsageLimit: z.number().int().positive().optional(),
    validFrom: z.string().datetime().optional(),
    validUntil: z.string().datetime().optional(),
    isActive: z.boolean().optional(),
  }),
});
