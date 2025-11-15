import { Gender } from '@prisma/client';

export interface IProduct {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  sku: string;
  gender: Gender;
  categoryId: string;
  isActive: boolean;
  isFeatured: boolean;
  createdAt: Date;
  updatedAt: Date;
  category?: {
    id: string;
    name: string;
    slug: string;
  };
  images?: IProductImage[];
  variants?: IProductVariant[];
}

export interface IProductCreate {
  name: string;
  slug: string;
  description: string;
  price: number;
  sku: string;
  gender: Gender;
  categoryId: string;
  isActive?: boolean;
  isFeatured?: boolean;
}

export interface IProductUpdate extends Partial<IProductCreate> {}

export interface IProductImage {
  id: string;
  productId: string;
  url: string;
  alt?: string;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IProductImageCreate {
  url: string;
  alt?: string;
  isPrimary?: boolean;
}

export interface IProductVariant {
  id: string;
  productId: string;
  size: string;
  color?: string;
  price?: number;
  sku: string;
  stock: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IProductVariantCreate {
  size: string;
  color?: string;
  price?: number;
  sku: string;
  stock: number;
  isActive?: boolean;
}

export interface IProductVariantUpdate extends Partial<IProductVariantCreate> {}

export interface IProductVariantBulkCreate {
  variants: IProductVariantCreate[];
}

export interface IProductReview {
  id: string;
  productId: string;
  userId: string;
  rating: number;
  title?: string;
  comment: string;
  isVerified: boolean;
  isApproved: boolean;
  createdAt: Date;
  updatedAt: Date;
  user?: {
    id: string;
    firstName: string;
    lastName: string;
    avatar?: string;
  };
}

export interface IProductReviewCreate {
  rating: number;
  title?: string;
  comment: string;
}

export interface IReview {
  id: string;
  userId: string;
  productId: string;
  rating: number;
  title?: string;
  comment: string;
  isVerified: boolean;
  isApproved: boolean;
  createdAt: Date;
  updatedAt: Date;
  user?: {
    id: string;
    firstName: string;
    lastName: string;
    avatar?: string;
  };
}

export interface IReviewUpdate {
  rating?: number;
  title?: string;
  comment?: string;
}

export interface IReviewFilters {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  approved?: boolean;
}

export interface IProductFilters {
  page?: number;
  limit?: number;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  gender?: Gender;
  isActive?: boolean;
  isFeatured?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface IProductImageUploadUrl {
  url: string;
  fields: Record<string, string>;
}
