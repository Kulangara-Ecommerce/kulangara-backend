import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { Prisma } from '@prisma/client';
import { cacheWrapper, deleteCachePattern, deleteCache } from '../services/cache.service';
import { ObjectId } from 'bson';
import { ICouponCreate, ICouponUpdate } from '../types/coupon.types';

// Cache keys
const CACHE_KEYS = {
  COUPONS_LIST: (query: any) => `coupons:list:${JSON.stringify(query)}`,
  COUPON_DETAILS: (id: string) => `coupons:details:${id}`,
  COUPON_CODE: (code: string) => `coupons:code:${code.toUpperCase()}`,
};

// Validate MongoDB ObjectId
const isValidObjectId = (id: string): boolean => {
  try {
    return ObjectId.isValid(id);
  } catch {
    return false;
  }
};

// List coupons (admin only)
export const listCoupons = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 10, isActive } = req.query;

    const normalizedQuery = {
      page: Number(page),
      limit: Number(limit),
      isActive: typeof isActive === 'string' ? isActive === 'true' : undefined,
    };

    const result = await cacheWrapper(
      CACHE_KEYS.COUPONS_LIST(normalizedQuery),
      async () => {
        const where: Prisma.CouponWhereInput = {
          isActive: normalizedQuery.isActive,
        };

        const [coupons, total] = await Promise.all([
          prisma.coupon.findMany({
            where,
            skip: (normalizedQuery.page - 1) * normalizedQuery.limit,
            take: normalizedQuery.limit,
            orderBy: { createdAt: 'desc' },
          }),
          prisma.coupon.count({ where }),
        ]);

        return {
          data: coupons,
          meta: {
            total,
            page: normalizedQuery.page,
            limit: normalizedQuery.limit,
            totalPages: Math.ceil(total / normalizedQuery.limit),
          },
        };
      },
      300 // Cache for 5 minutes
    );

    res.json({
      status: 'success',
      ...result,
    });
  } catch (error) {
    console.error('Error in listCoupons:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch coupons',
    });
  }
};

// Create coupon (admin only)
export const createCoupon = async (
  req: Request<{}, {}, ICouponCreate>,
  res: Response
): Promise<void> => {
  try {
    const coupon = await prisma.coupon.create({
      data: {
        ...req.body,
        code: req.body.code.toUpperCase(),
      },
    });

    // Invalidate relevant caches
    await deleteCachePattern(`${CACHE_KEYS.COUPONS_LIST}:*`);

    res.status(201).json({
      status: 'success',
      message: 'Coupon created successfully',
      data: { coupon },
    });
  } catch (error) {
    console.error('Error in createCoupon:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        res.status(400).json({
          status: 'error',
          message: 'A coupon with this code already exists',
        });
        return;
      }
    }
    res.status(500).json({
      status: 'error',
      message: 'Failed to create coupon',
    });
  }
};

// Update coupon (admin only)
export const updateCoupon = async (
  req: Request<{ id: string }, {}, ICouponUpdate>,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      res.status(400).json({
        status: 'error',
        message: 'Invalid coupon ID format',
      });
      return;
    }

    const coupon = await prisma.coupon.update({
      where: { id },
      data: req.body,
    });

    // Invalidate relevant caches
    await Promise.all([
      deleteCachePattern(`${CACHE_KEYS.COUPONS_LIST}:*`),
      deleteCache(CACHE_KEYS.COUPON_DETAILS(id)),
      deleteCache(CACHE_KEYS.COUPON_CODE(coupon.code)),
    ]);

    res.json({
      status: 'success',
      message: 'Coupon updated successfully',
      data: { coupon },
    });
  } catch (error) {
    console.error('Error in updateCoupon:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        res.status(404).json({
          status: 'error',
          message: 'Coupon not found',
        });
        return;
      }
    }
    res.status(500).json({
      status: 'error',
      message: 'Failed to update coupon',
    });
  }
};

// Delete coupon (admin only)
export const deleteCoupon = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!id || !isValidObjectId(id)) {
      res.status(400).json({
        status: 'error',
        message: 'Invalid coupon ID format',
      });
      return;
    }

    const coupon = await prisma.coupon.delete({
      where: { id },
    });

    // Invalidate relevant caches
    await Promise.all([
      deleteCachePattern(`${CACHE_KEYS.COUPONS_LIST}:*`),
      deleteCache(CACHE_KEYS.COUPON_DETAILS(id)),
      deleteCache(CACHE_KEYS.COUPON_CODE(coupon.code)),
    ]);

    res.json({
      status: 'success',
      message: 'Coupon deleted successfully',
    });
  } catch (error) {
    console.error('Error in deleteCoupon:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        res.status(404).json({
          status: 'error',
          message: 'Coupon not found',
        });
        return;
      }
    }
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete coupon',
    });
  }
};

// Validate coupon
export const validateCoupon = async (req: Request, res: Response): Promise<void> => {
  try {
    const { code } = req.params;
    const userId = req.user?.id;

    if (!code) {
      res.status(400).json({
        status: 'error',
        message: 'Coupon code is required',
      });
      return;
    }

    const result = await cacheWrapper(
      CACHE_KEYS.COUPON_CODE(code),
      async () => {
        const coupon = await prisma.coupon.findUnique({
          where: { code: code.toUpperCase() },
        });

        if (!coupon) {
          return {
            isValid: false,
            message: 'Invalid coupon code',
          };
        }

        // Check if coupon is active
        if (!coupon.isActive) {
          return {
            isValid: false,
            message: 'This coupon is inactive',
          };
        }

        // Check validity period
        const now = new Date();
        if (now < coupon.validFrom || now > coupon.validUntil) {
          return {
            isValid: false,
            message: 'This coupon has expired or is not yet valid',
          };
        }

        // Check usage limit
        if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
          return {
            isValid: false,
            message: 'This coupon has reached its usage limit',
          };
        }

        // Check per-user limit if userId is provided
        if (userId && coupon.userUsageLimit) {
          const userUsage = await prisma.order.count({
            where: {
              userId,
              couponId: coupon.id,
            },
          });

          if (userUsage >= coupon.userUsageLimit) {
            return {
              isValid: false,
              message: 'You have reached the usage limit for this coupon',
            };
          }
        }

        return {
          isValid: true,
          data: {
            id: coupon.id,
            code: coupon.code,
            type: coupon.type,
            value: coupon.value,
            maxDiscount: coupon.maxDiscount,
            minOrderValue: coupon.minOrderValue,
          },
        };
      },
      60 // Cache for 1 minute only since this is critical data
    );

    if (!result.isValid) {
      res.status(400).json({
        status: 'error',
        message: result.message,
      });
      return;
    }

    res.json({
      status: 'success',
      data: result.data,
    });
  } catch (error) {
    console.error('Error in validateCoupon:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to validate coupon',
    });
  }
};
