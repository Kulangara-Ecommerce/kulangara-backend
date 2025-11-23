import { Role, OrderStatus } from '@prisma/client';

export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING';

export interface IAnalyticsEvent {
  type: string;
  event: string;
  data: Record<string, any>;
  userId?: string;
  sessionId?: string;
  ip?: string;
  userAgent?: string;
}

export interface IAnalyticsFilters {
  startDate?: string;
  endDate?: string;
  type?: string;
  event?: string;
  userId?: string;
  page?: number;
  limit?: number;
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

export interface IDashboardStats {
  users: {
    total: number;
    activeUsers: number;
    newUsersToday: number;
    usersByStatus: Array<{
      status: UserStatus;
      count: number;
    }>;
  };
  orders: {
    total: number;
    totalRevenue: number;
    averageOrderValue: number;
    ordersToday: number;
    revenueToday: number;
  };
  products: {
    total: number;
    outOfStock: number;
    lowStock: number;
  };
}

export interface IAdminEmailSend {
  to: string[];
  subject: string;
  body: string;
  template?: string;
  data?: Record<string, any>;
}

export interface IUpdateUserRole {
  role: Role;
}

export interface IUpdateUserStatus {
  status: UserStatus;
}
