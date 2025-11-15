import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/db';
import { Gender, Prisma } from '@prisma/client';
import createError from 'http-errors';
import { UnauthorizedError } from '../utils/errors';
import {
  generateProductImageUploadURL,
  deleteProductImage as deleteS3Image,
} from '../services/upload.service';
import { cacheWrapper, deleteCachePattern, deleteCache } from '../services/cache.service';
import { ObjectId } from 'bson';
import {
    IProductCreate,
    IProductUpdate,
    IProductImageCreate,
    IProductReviewCreate,
    IProductFilters,
    IReviewUpdate,
    IReviewFilters,
    IProductVariantCreate,
    IProductVariantUpdate,
  IProductVariantBulkCreate,
} from '../types/product.types';

// Cache keys
const CACHE_KEYS = {
    PRODUCTS_LIST: (query: any) => `products:list:${JSON.stringify(query)}`,
    FEATURED_PRODUCTS: 'products:featured',
    PRODUCT_DETAILS: (id: string) => `products:details:${id}`,
    PRODUCT_REVIEWS: (id: string) => `products:${id}:reviews`,
  PRODUCT_SEARCH: (query: string) => `products:search:${query}`,
};

// Validate MongoDB ObjectId
const isValidObjectId = (id: string): boolean => {
    try {
        return ObjectId.isValid(id);
    } catch {
        return false;
    }
};

export const listProductsAdmin = async (
    req: Request<{}, {}, {}, IProductFilters>,
    res: Response
): Promise<void> => {
    try {
        const {
            page = 1,
            limit = 10,
            category,
            minPrice,
            maxPrice,
            gender,
            isActive,
            isFeatured,
            sortBy = 'createdAt',
      sortOrder = 'desc',
        } = req.query;

        const normalizedQuery = {
            page: Number(page),
            limit: Number(limit),
            category: category ? String(category) : undefined,
            minPrice: minPrice ? Number(minPrice) : undefined,
            maxPrice: maxPrice ? Number(maxPrice) : undefined,
            gender: gender ? (String(gender) as Gender) : undefined,
            isActive: typeof isActive === 'string' ? isActive === 'true' : undefined,
            isFeatured: typeof isFeatured === 'string' ? isFeatured === 'true' : undefined,
            sortBy,
      sortOrder,
        };

        // Create cache key based on query parameters
        const cacheKey = `products:admin:list:${JSON.stringify(normalizedQuery)}`;

        const result = await cacheWrapper(
            cacheKey,
            async () => {
                const where: Prisma.ProductWhereInput = {
                    isActive: normalizedQuery.isActive,
                    isFeatured: normalizedQuery.isFeatured,
                    categoryId: normalizedQuery.category,
                    gender: normalizedQuery.gender as Gender,
                    price: {
                        gte: normalizedQuery.minPrice,
            lte: normalizedQuery.maxPrice,
          },
                };

                const [products, total] = await Promise.all([
                    prisma.product.findMany({
                        where,
                        include: {
                            category: true,
                            images: true,
              variants: true,
                        },
                        skip: (normalizedQuery.page - 1) * normalizedQuery.limit,
                        take: normalizedQuery.limit,
                        orderBy: {
              [String(normalizedQuery.sortBy)]: normalizedQuery.sortOrder,
            },
                    }),
          prisma.product.count({ where }),
                ]);

                return {
                    data: products,
                    meta: {
                        total,
                        page: Number(page),
                        limit: Number(limit),
            totalPages: Math.ceil(total / Number(limit)),
          },
                };
            },
            300 // Cache for 5 minutes
        );

        res.json({
            status: 'success',
      data: result,
        });
    } catch (error) {
        console.error('Error in listProductsAdmin:', error);
        res.status(500).json({
            status: 'error',
      message: 'Failed to fetch products',
        });
    }
};

// List products with filters
export const listProducts = async (
    req: Request<{}, {}, {}, IProductFilters>,
    res: Response
): Promise<void> => {
    try {
        const {
            page = 1,
            limit = 10,
            category,
            minPrice,
            maxPrice,
            gender,
            isActive,
            isFeatured,
            sortBy = 'createdAt',
      sortOrder = 'desc',
        } = req.query;

        //products?page=3&limit=10&category=123&minPrice=100&maxPrice=1000&gender=male&isActive=true&isFeatured=true&sortBy=createdAt&sortOrder=desc

        const normalizedQuery = {
            page: Number(page),
            limit: Number(limit),
            category: category ? String(category) : undefined,
            minPrice: minPrice ? Number(minPrice) : undefined,
            maxPrice: maxPrice ? Number(maxPrice) : undefined,
            gender: gender ? (String(gender) as Gender) : undefined,
            isActive: typeof isActive === 'string' ? isActive === 'true' : undefined,
            isFeatured: typeof isFeatured === 'string' ? isFeatured === 'true' : undefined,
            sortBy,
      sortOrder,
        };

        // Create cache key based on query parameters
        const cacheKey = CACHE_KEYS.PRODUCTS_LIST(normalizedQuery);

        const result = await cacheWrapper(
            cacheKey,
            async () => {
                const where: Prisma.ProductWhereInput = {
                    isActive: normalizedQuery.isActive,
                    isFeatured: normalizedQuery.isFeatured,
                    categoryId: normalizedQuery.category,
                    gender: normalizedQuery.gender as Gender,
                    price: {
                        gte: normalizedQuery.minPrice,
            lte: normalizedQuery.maxPrice,
          },
                };

                const [products, total] = await Promise.all([
                    prisma.product.findMany({
                        where,
                        include: {
                            category: true,
                            images: {
                                where: { isPrimary: true },
                take: 1,
                        },
            },
            skip: (normalizedQuery.page - 1) * normalizedQuery.limit, //(3-1) * 10
                        take: normalizedQuery.limit,
                        orderBy: {
              [String(normalizedQuery.sortBy)]: normalizedQuery.sortOrder,
            },
                    }),
          prisma.product.count({ where }),
                ]);

                return {
                    data: products,
                    meta: {
                        total,
                        page: Number(page),
                        limit: Number(limit),
            totalPages: Math.ceil(total / Number(limit)),
          },
                };
            },
            300 // Cache for 5 minutes
        );

        res.json({
            status: 'success',
      data: result,
        });
    } catch (error) {
        console.error('Error in listProducts:', error);
        res.status(500).json({
            status: 'error',
      message: 'Failed to fetch products',
        });
    }
};

// Get featured products
export const getFeaturedProducts = async (_req: Request, res: Response): Promise<void> => {
    try {
        const cacheKey = CACHE_KEYS.FEATURED_PRODUCTS;

        const result = await cacheWrapper(
            cacheKey,
            async () => {
                const products = await prisma.product.findMany({
                    where: {
                        isFeatured: true,
            isActive: true,
                    },
                    include: {
                        category: true,
                        images: {
                            where: { isPrimary: true },
              take: 1,
                    },
          },
          take: 10,
                });
                return { data: products };
            },
            600 // Cache for 10 minutes
        );

        res.json({
            status: 'success',
      data: result,
        });
    } catch (error) {
        console.error('Error in getFeaturedProducts:', error);
        res.status(500).json({
            status: 'error',
      message: 'Failed to fetch featured products',
        });
    }
};

// Search products
export const searchProducts = async (req: Request, res: Response): Promise<void> => {
    try {
    const { q } = req.query; //search?q=sarbagila
        if (!q) {
            res.status(400).json({
                status: 'error',
        message: 'Search query is required',
            });
            return;
        }

        const cacheKey = CACHE_KEYS.PRODUCT_SEARCH(String(q));

        const result = await cacheWrapper(
            cacheKey,
            async () => {
                const products = await prisma.product.findMany({
                    where: {
                        OR: [
                            { name: { contains: String(q), mode: 'insensitive' } },
              { description: { contains: String(q), mode: 'insensitive' } },
                        ],
            isActive: true,
                    },
                    include: {
                        category: true,
                        images: {
                            where: { isPrimary: true },
              take: 1,
                    },
          },
          take: 20,
                });
                return { data: products };
            },
            300 // Cache for 5 minutes
        );

        res.json(result);
    } catch (error) {
        console.error('Error in searchProducts:', error);
        res.status(500).json({
      status: 'Error',
      message: 'Failed to search products',
    });
    }
};

// Get product by ID
export const getProductById = async (
    req: Request<{ id: string }>,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
    const { id } = req.params; //product/123

        // Validate ObjectId
        if (!isValidObjectId(id)) {
            res.status(400).json({
                status: 'error',
        message: 'Invalid product ID format',
            });
            return;
        }

        const cacheKey = CACHE_KEYS.PRODUCT_DETAILS(id);
        const result = await cacheWrapper(
            cacheKey,
            async () => {
                const product = await prisma.product.findUnique({
                    where: { id },
                    include: {
                        category: true,
                        images: true,
            variants: true,
          },
                });

                if (!product) {
                    res.status(404).json({
                        status: 'error',
            message: 'Product not found',
                    });
                    return;
                }
                return { data: product };
            },
            1800 // Cache for 30 minutes
        );

        res.json(result);
    } catch (error: unknown) {
        next(error);
    }
};

// Get product by slug
export const getProductBySlug = async (req: Request, res: Response) => {
    try {
    const { slug } = req.params; //product/slug/sarbagila
        const result = await cacheWrapper(
            `products:slug:${slug}`,
            async () => {
                const product = await prisma.product.findUnique({
                    where: { slug },
                    include: {
                        category: true,
                        images: true,
            variants: true,
          },
                });

                if (!product) throw createError(404, 'Product not found');
                return { data: product };
            },
            1800 // Cache for 30 minutes
        );

        res.json(result);
    } catch (error) {
        console.error('Error in getProductBySlug:', error);
        res.status(500).json({
            status: 'error',
      message: 'Failed to fetch product',
        });
    }
};

// Create product
export const createProduct = async (
  req: Request<{}, {}, IProductCreate>,
  res: Response
): Promise<void> => {
    try {
        // Validate categoryId format first
        if (!isValidObjectId(req.body.categoryId)) {
            res.status(400).json({
                status: 'error',
        message: 'Invalid category ID format',
            });
            return;
        }

        const product = await prisma.product.create({
            data: req.body,
            include: {
        category: true,
      },
        });

        // Invalidate relevant caches
        await Promise.all([
            deleteCachePattern(`${CACHE_KEYS.PRODUCTS_LIST}:*`),
            deleteCachePattern(`products:admin:list:*`),
      deleteCachePattern(CACHE_KEYS.FEATURED_PRODUCTS),
        ]);

        res.status(201).json({
            status: 'success',
            message: 'Product created successfully',
      data: { product },
        });
    } catch (error) {
        console.error('Error in createProduct:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2002') {
                res.status(400).json({
                    status: 'error',
          message: 'A product with this slug or SKU already exists',
                });
                return;
            }
        }
        res.status(500).json({
            status: 'error',
      message: 'Failed to create product',
        });
    }
};

// Update product
export const updateProduct = async (
    req: Request<{ id: string }, {}, IProductUpdate>,
    res: Response
): Promise<void> => {
    try {
        const { id } = req.params;
        const product = await prisma.product.update({
            where: { id },
            data: req.body,
            include: {
        category: true,
      },
        });

        // Invalidate relevant caches
        await Promise.all([
            deleteCachePattern(`${CACHE_KEYS.PRODUCTS_LIST}:*`),
            deleteCachePattern(`products:admin:list:*`),
            deleteCache(CACHE_KEYS.PRODUCT_DETAILS(id)),
            deleteCache(`products:slug:${product.slug}`),
      product.isFeatured && deleteCachePattern(CACHE_KEYS.FEATURED_PRODUCTS),
        ]);

        res.json({
            status: 'success',
            message: 'Product updated successfully',
      data: { product },
        });
    } catch (error) {
        console.error('Error in updateProduct:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2002') {
                res.status(400).json({
                    status: 'error',
          message: 'A product with this slug or SKU already exists',
                });
                return;
            }
            if (error.code === 'P2025') {
                res.status(404).json({
                    status: 'error',
          message: 'Product not found',
                });
                return;
            }
        }
        res.status(500).json({
            status: 'error',
      message: 'Failed to update product',
        });
    }
};

// Delete product
export const deleteProduct = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
    
    if (!id) {
      res.status(400).json({
        status: 'error',
        message: 'Product ID is required',
      });
      return;
    }

        await prisma.product.delete({
      where: { id },
        });

        // Invalidate relevant caches
        await Promise.all([
            deleteCachePattern(`${CACHE_KEYS.PRODUCTS_LIST}:*`),
            deleteCachePattern(`products:admin:list:*`),
            deleteCache(CACHE_KEYS.PRODUCT_DETAILS(id)),
      deleteCachePattern(CACHE_KEYS.FEATURED_PRODUCTS),
        ]);

        res.json({
            status: 'success',
      message: 'Product deleted successfully',
        });
    } catch (error) {
        console.error('Error in deleteProduct:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2025') {
                res.status(404).json({
                    status: 'error',
          message: 'Product not found',
                });
                return;
            }
        }
        res.status(500).json({
            status: 'error',
      message: 'Failed to delete product',
        });
    }
};

// Generate presigned URLs for product image upload
export const getProductImageUploadUrls = async (req: Request, res: Response): Promise<void> => {
    try {
        const { fileTypes } = req.body;
        if (!Array.isArray(fileTypes)) {
            res.status(400).json({
                status: 'error',
        message: 'fileTypes must be an array',
            });
            return;
        }

        const uploadUrls = await Promise.all(
            fileTypes.map(async (fileType) => {
                return generateProductImageUploadURL(fileType);
            })
        );

        res.json({
            status: 'success',
            message: 'Upload URLs generated successfully',
      data: { uploadUrls },
        });
    } catch (error) {
        console.error('Error in getProductImageUploadUrls:', error);
        res.status(500).json({
            status: 'error',
      message: 'Failed to generate upload URLs',
        });
    }
};

// Upload product images
export const uploadProductImages = async (
    req: Request<{ id: string }, {}, { images: IProductImageCreate[] }>,
    res: Response
): Promise<void> => {
    try {
        const { id } = req.params;
        const { images } = req.body;

        if (!Array.isArray(images)) {
            res.status(400).json({
                status: 'error',
        message: 'images must be an array',
            });
            return;
        }

        const product = await prisma.product.update({
            where: { id },
            data: {
                images: {
                    createMany: {
                        data: images.map((image) => ({
                            url: image.url,
                            alt: image.alt,
              isPrimary: image.isPrimary || false,
            })),
          },
        },
            },
            include: {
        images: true,
      },
        });

        res.json({
            status: 'success',
            message: 'Product images uploaded successfully',
      data: { product },
        });
    } catch (error) {
        console.error('Error in uploadProductImages:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2025') {
                res.status(404).json({
                    status: 'error',
          message: 'Product not found',
                });
                return;
            }
        }
        res.status(500).json({
            status: 'error',
      message: 'Failed to upload product images',
        });
    }
};

// Delete product image
export const deleteProductImage = async (req: Request, res: Response): Promise<void> => {
    try {
        const { imageId } = req.params;

        // Get the image URL before deleting
        const image = await prisma.productImage.findUnique({
      where: { id: imageId },
        });

        if (!image) {
            res.status(404).json({
                status: 'error',
        message: 'Image not found',
            });
            return;
        }

        // Delete from S3
        await deleteS3Image(image.url);

        // Delete from database
        await prisma.productImage.delete({
      where: { id: imageId },
        });

        await Promise.all([
            deleteCache(CACHE_KEYS.PRODUCT_DETAILS(image.productId)),
      deleteCachePattern(`products:slug:*`),
        ]);

        res.json({
            status: 'success',
      message: 'Product image deleted successfully',
        });
    } catch (error) {
        console.error('Error in deleteProductImage:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2025') {
                res.status(404).json({
                    status: 'error',
          message: 'Image not found',
                });
                return;
            }
        }
        res.status(500).json({
            status: 'error',
      message: 'Failed to delete product image',
        });
    }
};

// Create product variant
export const createProductVariant = async (
    req: Request<{ id: string }, {}, IProductVariantCreate>,
    res: Response
): Promise<void> => {
    try {
        const { id } = req.params;

        // Check if product exists
        const product = await prisma.product.findUnique({
      where: { id },
        });

        if (!product) {
            res.status(404).json({
                status: 'error',
        message: 'Product not found',
            });
            return;
        }

        const variant = await prisma.productVariant.create({
            data: {
                ...req.body,
        productId: id,
      },
        });

        // Invalidate product cache
        await deleteCache(CACHE_KEYS.PRODUCT_DETAILS(id));

        res.status(201).json({
            status: 'success',
            message: 'Product variant created successfully',
      data: { variant },
        });
    } catch (error) {
        console.error('Error in createProductVariant:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2002') {
                res.status(400).json({
                    status: 'error',
          message: 'A variant with this SKU already exists',
                });
                return;
            }
        }
        res.status(500).json({
            status: 'error',
      message: 'Failed to create product variant',
        });
    }
};

// Create multiple product variants
export const createProductVariants = async (
    req: Request<{ id: string }, {}, IProductVariantBulkCreate>,
    res: Response
): Promise<void> => {
    try {
        const { id } = req.params;
        const { variants } = req.body;

        // Check if product exists
        const product = await prisma.product.findUnique({
      where: { id },
        });

        if (!product) {
            res.status(404).json({
                status: 'error',
        message: 'Product not found',
            });
            return;
        }

        const createdVariants = await prisma.productVariant.createMany({
      data: variants.map((variant) => ({
                ...variant,
        productId: id,
      })),
        });

        // Invalidate product cache
        await deleteCache(CACHE_KEYS.PRODUCT_DETAILS(id));

        res.status(201).json({
            status: 'success',
            message: 'Product variants created successfully',
      data: { count: createdVariants.count },
        });
    } catch (error) {
        console.error('Error in createProductVariants:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2002') {
                res.status(400).json({
                    status: 'error',
          message: 'One or more variants have duplicate SKUs',
                });
                return;
            }
        }
        res.status(500).json({
            status: 'error',
      message: 'Failed to create product variants',
        });
    }
};

// Update product variant
export const updateProductVariant = async (
    req: Request<{ id: string; variantId: string }, {}, IProductVariantUpdate>,
    res: Response
): Promise<void> => {
    try {
        const { id, variantId } = req.params;

        const variant = await prisma.productVariant.update({
            where: {
                id: variantId,
        productId: id,
            },
      data: req.body,
        });

        // Invalidate product cache
        await deleteCache(CACHE_KEYS.PRODUCT_DETAILS(id));

        res.json({
            status: 'success',
            message: 'Product variant updated successfully',
      data: { variant },
        });
    } catch (error) {
        console.error('Error in updateProductVariant:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2002') {
                res.status(400).json({
                    status: 'error',
          message: 'A variant with this SKU already exists',
                });
                return;
            }
            if (error.code === 'P2025') {
                res.status(404).json({
                    status: 'error',
          message: 'Variant not found',
                });
                return;
            }
        }
        res.status(500).json({
            status: 'error',
      message: 'Failed to update product variant',
        });
    }
};

// Delete product variant
export const deleteProductVariant = async (
    req: Request<{ id: string; variantId: string }>,
    res: Response
): Promise<void> => {
    try {
        const { id, variantId } = req.params;

        await prisma.productVariant.delete({
            where: {
                id: variantId,
        productId: id,
      },
        });

        // Invalidate product cache
        await deleteCache(CACHE_KEYS.PRODUCT_DETAILS(id));

        res.json({
            status: 'success',
      message: 'Product variant deleted successfully',
        });
    } catch (error) {
        console.error('Error in deleteProductVariant:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2025') {
                res.status(404).json({
                    status: 'error',
          message: 'Variant not found',
                });
                return;
            }
        }
        res.status(500).json({
            status: 'error',
      message: 'Failed to delete product variant',
        });
    }
};

// Get product reviews
export const getProductReviews = async (
    req: Request<{ id: string }, {}, {}, IReviewFilters>,
    res: Response
): Promise<void> => {
    try {
    const { id } = req.params; //products/123/reviews
        const {
            page = 1,
            limit = 10,
            sortBy = 'createdAt',
            sortOrder = 'desc',
      approved = true,
        } = req.query;

        const where: Prisma.ReviewWhereInput = {
            productId: id,
      isApproved: typeof approved === 'string' ? approved === 'true' : approved,
        };

        const reviews = await prisma.review.findMany({
            where,
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
            avatar: true,
          },
        },
            },
            skip: (Number(page) - 1) * Number(limit),
            take: Number(limit),
            orderBy: {
        [String(sortBy)]: sortOrder,
      },
        });

        const total = await prisma.review.count({ where });

        const ratingStats = await prisma.review.groupBy({
            by: ['rating'],
            where: {
                productId: id,
        isApproved: true,
            },
            _count: {
        _all: true,
            },
            orderBy: {
        rating: 'asc',
      },
        });

        const avgRating = await prisma.review.aggregate({
            where: {
                productId: id,
        isApproved: true,
            },
            _avg: {
        rating: true,
      },
        });

        res.json({
            status: 'success',
            data: {
                reviews,
                meta: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    totalPages: Math.ceil(total / Number(limit)),
                    stats: {
                        averageRating: avgRating._avg.rating || 0,
            ratingDistribution: ratingStats,
          },
        },
      },
        });
    } catch (error) {
        console.error('Error in getProductReviews:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2025') {
                res.status(404).json({
                    status: 'error',
          message: 'Product not found',
                });
                return;
            }
        }
        res.status(500).json({
            status: 'error',
      message: 'Failed to fetch product reviews',
        });
    }
};

// Create product review
export const createProductReview = async (
    req: Request<{ id: string }, {}, IProductReviewCreate>,
    res: Response
): Promise<void> => {
    try {
        const { id } = req.params;
    if (!req.user?.id) {
      throw new UnauthorizedError('User not authenticated');
    }
    const userId = req.user.id;

        // Check if user has already reviewed this product
        const existingReview = await prisma.review.findFirst({
            where: {
        AND: [{ userId }, { productId: id }],
      },
        });

        if (existingReview) {
            res.status(400).json({
                status: 'error',
        message: 'You have already reviewed this product',
            });
            return;
        }

        // Check if user has purchased the product
        const hasVerifiedPurchase = await prisma.orderItem.findFirst({
            where: {
                productId: id,
                order: {
          userId,
        },
      },
        });

        const review = await prisma.review.create({
            data: {
                ...req.body,
                productId: id,
                userId,
        isVerified: !!hasVerifiedPurchase,
            },
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
            avatar: true,
          },
        },
      },
        });

        res.status(201).json({
            status: 'success',
            message: 'Review created successfully',
      data: { review },
        });
    } catch (error) {
        console.error('Error in createProductReview:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2002') {
                res.status(400).json({
                    status: 'error',
          message: 'You have already reviewed this product',
                });
                return;
            }
            if (error.code === 'P2025') {
                res.status(404).json({
                    status: 'error',
          message: 'Product not found',
                });
                return;
            }
        }
        res.status(500).json({
            status: 'error',
      message: 'Failed to create review',
        });
    }
};

// Update product review
export const updateProductReview = async (
    req: Request<{ reviewId: string }, {}, IReviewUpdate>,
    res: Response
): Promise<void> => {
    try {
        const { reviewId } = req.params;
        const userId = req.user?.id;

        const review = await prisma.review.update({
            where: {
                id: reviewId,
        userId,
            },
            data: {
                ...req.body,
        updatedAt: new Date(),
            },
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
            avatar: true,
          },
        },
      },
        });

        res.json({
            status: 'success',
            message: 'Review updated successfully',
      data: { review },
        });
    } catch (error) {
        console.error('Error in updateProductReview:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2025') {
                res.status(404).json({
                    status: 'error',
          message: 'Review not found or unauthorized',
                });
                return;
            }
        }
        res.status(500).json({
            status: 'error',
      message: 'Failed to update review',
        });
    }
};

// Delete product review
export const deleteProductReview = async (req: Request, res: Response): Promise<void> => {
    try {
        const { reviewId } = req.params;
        const userId = req.user?.id;

        await prisma.review.delete({
            where: {
                id: reviewId,
        userId,
      },
        });

        res.json({
            status: 'success',
      message: 'Review deleted successfully',
        });
    } catch (error) {
        console.error('Error in deleteProductReview:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2025') {
                res.status(404).json({
                    status: 'error',
          message: 'Review not found or unauthorized',
                });
                return;
            }
        }
        res.status(500).json({
            status: 'error',
      message: 'Failed to delete review',
        });
    }
};
