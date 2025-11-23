import { OrderStatus } from '@prisma/client';

// Request Interfaces
export interface IOrderCreate {
  shippingAddressId: string;
  paymentMethod: string;
  items: Array<{
    productId: string;
    variantId?: string;
    quantity: number;
  }>;
  couponCode?: string;
}

export interface IOrderStatusUpdate {
  status: OrderStatus;
  note?: string;
  trackingNumber?: string;
  estimatedDelivery?: Date;
}

export interface IOrderFilters {
  page?: number;
  limit?: number;
  status?: OrderStatus;
  startDate?: string;
  endDate?: string;
  search?: string;
}

// Response Interfaces
export interface IOrderItem {
  id: string;
  productId: string;
  variantId?: string;
  quantity: number;
  price: number;
  product: {
    name: string;
    images?: Array<{
      url: string;
      isPrimary: boolean;
    }>;
  };
  variant?: {
    name: string;
    sku: string;
  };
}

export interface IShippingAddress {
  id: string;
  fullName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
}

export interface IStatusHistory {
  id: string;
  status: OrderStatus;
  note?: string;
  updatedBy?: string;
  createdAt: Date;
}

export interface IOrderResponse {
  id: string;
  orderNumber: string;
  userId: string;
  status: OrderStatus;
  items: IOrderItem[];
  shippingAddress: IShippingAddress;
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  paymentMethod: string;
  trackingNumber?: string;
  estimatedDelivery?: Date;
  statusHistory: IStatusHistory[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IOrderAnalytics {
  totalOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
  statusDistribution: Array<{
    status: OrderStatus;
    count: number;
  }>;
  dailyOrders: Array<{
    date: Date;
    orders: number;
    revenue: number;
  }>;
  topProducts: Array<{
    productId: string;
    quantity: number;
    revenue: number;
    productDetails?: {
      id: string;
      name: string;
      price: number;
      category?: any;
    };
  }>;
  paymentAnalytics: {
    methodDistribution: Array<{
      method: string;
      count: number;
      volume: number;
    }>;
  };
  customerAnalytics: {
    totalCustomers: number;
    repeatCustomers: number;
    repeatCustomerRate: number;
    averageOrdersPerCustomer: number;
    customerLifetimeValue: number;
  };
  timeAnalytics: {
    hourlyDistribution: number[];
    peakHour: number;
  };
  promotionAnalytics: {
    couponUsage: number;
    totalDiscount: number;
    averageDiscount: number;
  };
  growthAnalytics: {
    revenueGrowth: number;
    orderGrowth: number;
    previousPeriodRevenue: number;
    previousPeriodOrders: number;
  };
  locationAnalytics: {
    stateDistribution: Array<{
      state: string;
      orders: number;
      revenue: number;
    }>;
    cityDistribution: Array<{
      city: string;
      state: string;
      orders: number;
      revenue: number;
    }>;
    topCities: Array<{
      city: string;
      state: string;
      orders: number;
      revenue: number;
    }>;
    deliveryZones: Array<{
      pincode: string;
      city: string;
      state: string;
      orders: number;
      averageDeliveryTime?: number;
    }>;
  };
}
