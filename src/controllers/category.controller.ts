import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { Prisma } from '@prisma/client';
// import { ObjectId } from 'bson';
import { cacheWrapper, deleteCachePattern, deleteCache } from '../services/cache.service';
import { ICategoryCreate, ICategoryUpdate, ICategoryFilters } from '../types/category.types';

// Cache keys
const CACHE_KEYS = {
  CATEGORIES_LIST: (query: any) => `categories:list:${JSON.stringify(query)}`,
  CATEGORY_DETAILS: (id: string) => `categories:details:${id}`,
  CATEGORY_TREE: 'categories:tree',
};

// Validate MongoDB ObjectId
// const isValidObjectId = (id: string): boolean => {
//   try {
//     return ObjectId.isValid(id);
//   } catch {
//     return false;
//   }
// };

// List categories with filters
export const listCategories = async (
  req: Request<{}, {}, {}, ICategoryFilters>,
  res: Response
): Promise<void> => {
  try {
    const {
      page = 1,
      limit = 10,
      parentId,
      isActive,
      sortBy = 'sortOrder',
      sortOrder = 'asc',
    } = req.query;

    const normalizedQuery = {
      page: Number(page),
      limit: Number(limit),
      parentId: parentId ? String(parentId) : undefined,
      isActive: typeof isActive === 'string' ? isActive === 'true' : undefined,
      sortBy,
      sortOrder,
    };

    const cacheKey = CACHE_KEYS.CATEGORIES_LIST(normalizedQuery);

    const result = await cacheWrapper(
      cacheKey,
      async () => {
        const where: Prisma.CategoryWhereInput = {
          parentId: normalizedQuery.parentId,
          isActive: normalizedQuery.isActive,
        };

        const [categories, total] = await Promise.all([
          prisma.category.findMany({
            where,
            include: {
              parent: true,
              children: true,
              _count: {
                select: { products: true },
              },
            },
            skip: (normalizedQuery.page - 1) * normalizedQuery.limit,
            take: normalizedQuery.limit,
            orderBy: {
              [String(normalizedQuery.sortBy)]: normalizedQuery.sortOrder,
            },
          }),
          prisma.category.count({ where }),
        ]);

        return {
          data: categories,
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
    console.error('Error in listCategories:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch categories',
    });
  }
};

// Get category by ID
export const getCategoryById = async (
  req: Request<{ id: string }>,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

      if (!id) {
      res.status(400).json({
        status: 'error',
        message: 'Invalid category ID format',
      });
      return;
    }

    const cacheKey = CACHE_KEYS.CATEGORY_DETAILS(id);
    const result = await cacheWrapper(
      cacheKey,
      async () => {
        const category = await prisma.category.findUnique({
          where: { id },
          include: {
            parent: true,
            children: true,
            _count: {
              select: { products: true },
            },
          },
        });

        if (!category) {
          res.status(404).json({
            status: 'error',
            message: 'Category not found',
          });
          return;
        }

        return { data: category };
      },
      1800 // Cache for 30 minutes
    );

    res.json(result);
  } catch (error) {
    console.error('Error in getCategoryById:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch category',
    });
  }
};

// Create category
export const createCategory = async (
  req: Request<{}, {}, ICategoryCreate>,
  res: Response
): Promise<void> => {
  try {
    const category = await prisma.category.create({
      data: req.body,
      include: {
        parent: true,
        children: true,
      },
    });

    // Invalidate relevant caches
    await Promise.all([
      deleteCachePattern(`${CACHE_KEYS.CATEGORIES_LIST}:*`),
      deleteCachePattern(CACHE_KEYS.CATEGORY_TREE),
    ]);

    res.status(201).json({
      status: 'success',
      message: 'Category created successfully',
      data: { category },
    });
  } catch (error) {
    console.error('Error in createCategory:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        res.status(400).json({
          status: 'error',
          message: 'A category with this name or slug already exists',
        });
        return;
      }
    }
    res.status(500).json({
      status: 'error',
      message: 'Failed to create category',
    });
  }
};

// Update category
export const updateCategory = async (
  req: Request<{ id: string }, {}, ICategoryUpdate>,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const category = await prisma.category.update({
      where: { id },
      data: req.body,
      include: {
        parent: true,
        children: true,
      },
    });

    // Invalidate relevant caches
    await Promise.all([
      deleteCachePattern(`${CACHE_KEYS.CATEGORIES_LIST}:*`),
      deleteCache(CACHE_KEYS.CATEGORY_DETAILS(id)),
      deleteCachePattern(CACHE_KEYS.CATEGORY_TREE),
    ]);

    res.json({
      status: 'success',
      message: 'Category updated successfully',
      data: { category },
    });
  } catch (error) {
    console.error('Error in updateCategory:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        res.status(400).json({
          status: 'error',
          message: 'A category with this name or slug already exists',
        });
        return;
      }
      if (error.code === 'P2025') {
        res.status(404).json({
          status: 'error',
          message: 'Category not found',
        });
        return;
      }
    }
    res.status(500).json({
      status: 'error',
      message: 'Failed to update category',
    });
  }
};

// Delete category
export const deleteCategory = async (
  req: Request<{ id: string }>,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    // Check if category has products
    const categoryWithProducts = await prisma.category.findUnique({
      where: { id },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    if (categoryWithProducts?._count?.products ?? 0 > 0) {
      res.status(400).json({
        status: 'error',
        message: 'Cannot delete category with associated products',
      });
      return;
    }

    // Check if category has children
    const categoryWithChildren = await prisma.category.findUnique({
      where: { id },
      include: {
        _count: {
          select: { children: true },
        },
      },
    });

    if (categoryWithChildren?._count?.children ?? 0 > 0) {
      res.status(400).json({
        status: 'error',
        message: 'Cannot delete category with child categories',
      });
      return;
    }

    await prisma.category.delete({
      where: { id },
    });

    // Invalidate relevant caches
    await Promise.all([
      deleteCachePattern(`${CACHE_KEYS.CATEGORIES_LIST}:*`),
      deleteCache(CACHE_KEYS.CATEGORY_DETAILS(id)),
      deleteCachePattern(CACHE_KEYS.CATEGORY_TREE),
    ]);

    res.json({
      status: 'success',
      message: 'Category deleted successfully',
    });
  } catch (error) {
    console.error('Error in deleteCategory:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        res.status(404).json({
          status: 'error',
          message: 'Category not found',
        });
        return;
      }
    }
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete category',
    });
  }
};
