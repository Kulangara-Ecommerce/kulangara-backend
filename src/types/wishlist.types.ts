import { Wishlist } from '@prisma/client';

export interface IWishlistResponse extends Wishlist {
  product: {
    id: string;
    name: string;
    slug: string;
    price: number;
    discountedPrice?: number;
    images: Array<{
      url: string;
      isPrimary: boolean;
    }>;
  };
}
