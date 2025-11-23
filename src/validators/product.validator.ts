import { z } from 'zod';

export const GenderEnum = z.enum(['MEN', 'WOMEN', 'UNISEX']);

export const createProductSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(100),
    slug: z.string().min(2).max(100),
    description: z.string().min(10),
    shortDescription: z.string().min(10).optional(),
    price: z.number().positive(),
    discountedPrice: z.number().positive().optional(),
    costPrice: z.number().positive().optional(),
    sku: z.string().min(3).max(50),
    stockQuantity: z.number().int().min(0),
    lowStockThreshold: z.number().int().min(1).optional(),
    isActive: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    metaTitle: z.string().max(100).optional(),
    metaDescription: z.string().max(200).optional(),
    material: z.string().optional(),
    care: z.array(z.string()).optional(),
    features: z.array(z.string()).optional(),
    dimensions: z.string().optional(),
    weight: z.number().positive().optional(),
    gender: GenderEnum.optional(),
    categoryId: z.string(),
  }),
});

export const updateProductSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(100).optional(),
    slug: z.string().min(2).max(100).optional(),
    description: z.string().min(10).optional(),
    shortDescription: z.string().min(10).optional(),
    price: z.number().positive().optional(),
    discountedPrice: z.number().positive().optional(),
    costPrice: z.number().positive().optional(),
    sku: z.string().min(3).max(50).optional(),
    stockQuantity: z.number().int().min(0).optional(),
    lowStockThreshold: z.number().int().min(1).optional(),
    isActive: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    metaTitle: z.string().max(100).optional(),
    metaDescription: z.string().max(200).optional(),
    material: z.string().optional(),
    care: z.array(z.string()).optional(),
    features: z.array(z.string()).optional(),
    dimensions: z.string().optional(),
    weight: z.number().positive().optional(),
    gender: GenderEnum.optional(),
    categoryId: z.string().optional(),
  }),
});

export const createVariantSchema = z.object({
  body: z.object({
    size: z.string().min(1).max(20),
    color: z.string().min(1).max(50).optional(),
    price: z.number().positive().optional(),
    sku: z.string().min(3).max(50),
    stock: z.number().int().min(0),
    isActive: z.boolean().optional(),
  }),
});

export const updateVariantSchema = z.object({
  body: z.object({
    size: z.string().min(1).max(20).optional(),
    color: z.string().min(1).max(50).optional(),
    price: z.number().positive().optional(),
    sku: z.string().min(3).max(50).optional(),
    stock: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
  }),
});

export const createVariantBulkSchema = z.object({
  body: z.object({
    variants: z
      .array(
        z.object({
          size: z.string().min(1).max(20),
          color: z.string().min(1).max(50).optional(),
          price: z.number().positive().optional(),
          sku: z.string().min(3).max(50),
          stock: z.number().int().min(0),
          isActive: z.boolean().optional(),
        })
      )
      .min(1),
  }),
});

export const createReviewSchema = z.object({
  body: z.object({
    rating: z.number().int().min(1).max(5),
    title: z.string().min(3).max(100).optional(),
    comment: z.string().min(10).max(1000),
  }),
});

export const updateReviewSchema = z.object({
  body: z.object({
    rating: z.number().int().min(1).max(5).optional(),
    title: z.string().min(3).max(100).optional(),
    comment: z.string().min(10).max(1000).optional(),
  }),
});
