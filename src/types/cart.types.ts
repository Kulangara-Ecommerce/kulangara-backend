import { Cart, CartItem } from '@prisma/client';

export interface ICartItemCreate {
  productId: string;
  variantId?: string;
  quantity: number;
}

export interface ICartItemUpdate {
  quantity: number;
}

export interface ICartWithItems extends Cart {
  items: CartItem[];
}

export interface ICartResponse {
  id: string;
  items: Array<{
    id: string;
    productId: string;
    variantId?: string;
    quantity: number;
    price: number;
    subtotal: number;
    product: {
      name: string;
      slug: string;
      images: Array<{
        url: string;
        isPrimary: boolean;
      }>;
    };
    variant?: {
      name: string;
      sku: string;
    };
  }>;
  subtotal: number;
  total: number;
  createdAt: Date;
  updatedAt: Date;
}
