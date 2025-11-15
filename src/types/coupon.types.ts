type DiscountType = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING';

export interface ICoupon {
  id: string;
  code: string;
  name: string;
  description?: string;
  type: DiscountType;
  value: number;
  maxDiscount?: number;
  minOrderValue?: number;
  usageLimit?: number;
  usageCount: number;
  userUsageLimit?: number;
  validFrom: Date;
  validUntil: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICouponCreate {
  code: string;
  name: string;
  description?: string;
  type: DiscountType;
  value: number;
  maxDiscount?: number;
  minOrderValue?: number;
  usageLimit?: number;
  userUsageLimit?: number;
  validFrom: Date;
  validUntil: Date;
  isActive?: boolean;
}

export interface ICouponUpdate {
  name?: string;
  description?: string;
  type?: DiscountType;
  value?: number;
  maxDiscount?: number;
  minOrderValue?: number;
  usageLimit?: number;
  userUsageLimit?: number;
  validFrom?: Date;
  validUntil?: Date;
  isActive?: boolean;
}

export interface ICouponValidation {
  isValid: boolean;
  message?: string;
  data?: {
    id: string;
    code: string;
    type: DiscountType;
    value: number;
    maxDiscount?: number;
    minOrderValue?: number;
  };
}
