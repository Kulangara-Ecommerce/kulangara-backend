import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { cacheWrapper } from '../services/cache.service';
import { IAnalyticsFilters, IDashboardStats, IOrderAnalytics } from '../types/analytics.types';
import { OrderStatus } from '@prisma/client';

// Cache keys
const CACHE_KEYS = {
  ANALYTICS: (query: Record<string, unknown>): string => `analytics:${JSON.stringify(query)}`,
    DASHBOARD: 'admin:dashboard',
  ORDER_ANALYTICS: 'orders:analytics',
};

// Get user analytics data
export const getAnalytics = async (
  req: Request<
    Record<string, never>,
    Record<string, never>,
    Record<string, never>,
    IAnalyticsFilters
  >,
    res: Response
): Promise<void> => {
    try {
    const { startDate, endDate } = req.query;

        // Parse date parameters
    const startDateTime = startDate
      ? new Date(startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const endDateTime = endDate ? new Date(endDate) : new Date();
        
        // Calculate previous period for growth comparison
        const periodDuration = endDateTime.getTime() - startDateTime.getTime();
        const previousPeriodStart = new Date(startDateTime.getTime() - periodDuration);
        const previousPeriodEnd = new Date(startDateTime.getTime());

        const result = await cacheWrapper(
            `${CACHE_KEYS.ANALYTICS({ startDate, endDate })}`,
            async () => {
                const [
                    _totalUsers,
                    newUsersInPeriod,
                    activeUsersInPeriod,
                    usersByRole,
                    usersByStatus,
                    dailyRegistrations,
          previousPeriodRegistrations,
                ] = await Promise.all([
                    // Total users registered in date range
                    prisma.user.count({
                        where: {
                            createdAt: {
                                gte: startDateTime,
                lte: endDateTime,
              },
            },
                    }),

                    // New users in the specified period
                    prisma.user.count({
                        where: {
                            createdAt: {
                                gte: startDateTime,
                lte: endDateTime,
              },
            },
                    }),

                    // Active users in the period (users who have logged in during the period)
                    prisma.user.count({
                        where: {
                            lastLoginAt: {
                                gte: startDateTime,
                lte: endDateTime,
              },
            },
                    }),

                    // Users by role in the period
                    prisma.user.groupBy({
                        by: ['role'],
                        where: {
                            createdAt: {
                                gte: startDateTime,
                lte: endDateTime,
              },
                        },
            _count: true,
                    }),

                    // Users by status in the period
                    prisma.user.groupBy({
                        by: ['isActive'],
                        where: {
                            createdAt: {
                                gte: startDateTime,
                lte: endDateTime,
              },
                        },
            _count: true,
                    }),

                    // Daily registrations
                    prisma.user.groupBy({
                        by: ['createdAt'],
                        where: {
                            createdAt: {
                                gte: startDateTime,
                lte: endDateTime,
              },
                        },
            _count: true,
                    }),

                    // Previous period registrations for growth comparison
                    prisma.user.count({
                        where: {
                            createdAt: {
                                gte: previousPeriodStart,
                lt: previousPeriodEnd,
              },
            },
          }),
                ]);

                // Calculate growth rate
        const userGrowth =
          previousPeriodRegistrations > 0
                    ? ((newUsersInPeriod - previousPeriodRegistrations) / previousPeriodRegistrations) * 100 
                    : 0;

                // Format daily registrations
        const dailyRegistrationData = dailyRegistrations.map((day) => ({
                    date: day.createdAt,
          registrations: day._count,
                }));

                const analytics = {
                    totalUsers: newUsersInPeriod,
                    activeUsers: activeUsersInPeriod,
          usersByRole: usersByRole.map((item) => ({
                        role: item.role,
            count: item._count,
                    })),
          usersByStatus: usersByStatus.map((item) => ({
                        status: item.isActive ? 'ACTIVE' : 'INACTIVE',
            count: item._count,
                    })),
                    dailyRegistrations: dailyRegistrationData,
                    growthAnalytics: {
                        userGrowth,
                        previousPeriodUsers: previousPeriodRegistrations,
            currentPeriodUsers: newUsersInPeriod,
                    },
                    period: {
                        startDate: startDateTime,
            endDate: endDateTime,
          },
                };

                return analytics;
            },
            60 // Cache for 1 minute
        );

        res.json({
            status: 'success',
      data: result,
        });
    } catch (error) {
        console.error('Error in getAnalytics:', error);
        res.status(500).json({
            status: 'error',
      message: 'Failed to fetch user analytics data',
        });
    }
};

// Get dashboard stats
export const getDashboardStats = async (_req: Request, res: Response): Promise<void> => {
    try {
        const result = await cacheWrapper(
            CACHE_KEYS.DASHBOARD,
            async () => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                const [
                    totalUsers,
                    activeUsers,
                    newUsersToday,
                    usersByStatus,
                    totalOrders,
                    ordersToday,
                    orderStats,
                    products,
                    outOfStockProducts,
          lowStockProducts,
                ] = await Promise.all([
                    // Total users
                    prisma.user.count(),

                    // Active users
                    prisma.user.count({
            where: { isActive: true },
                    }),

                    // New users today
                    prisma.user.count({
                        where: {
                            createdAt: {
                gte: today,
              },
            },
                    }),

                    // Users by status
                    prisma.user.groupBy({
                        by: ['isActive'],
            _count: true,
                    }),

                    // Total orders
                    prisma.order.count(),

                    // Orders today
                    prisma.order.count({
                        where: {
                            createdAt: {
                gte: today,
              },
            },
                    }),

                    // Order stats
                    prisma.order.aggregate({
                        _sum: {
              totalAmount: true,
                        },
                        _avg: {
              totalAmount: true,
                        },
                        where: {
                            createdAt: {
                gte: today,
              },
            },
                    }),

                    // Total products
                    prisma.product.count(),

                    // Out of stock products
                    prisma.product.count({
                        where: {
              stockQuantity: 0,
            },
                    }),

                    // Low stock products (less than 10)
                    prisma.product.count({
                        where: {
                            stockQuantity: {
                                gt: 0,
                lte: 10,
              },
            },
          }),
                ]);

                const stats: IDashboardStats = {
                    users: {
                        total: totalUsers,
                        activeUsers,
                        newUsersToday,
                        usersByStatus: [
                            {
                                status: 'ACTIVE',
                count: usersByStatus.find((s) => s.isActive)?._count || 0,
                            },
                            {
                                status: 'INACTIVE',
                count: usersByStatus.find((s) => !s.isActive)?._count || 0,
              },
            ],
                    },
                    orders: {
                        total: totalOrders,
                        totalRevenue: orderStats._sum.totalAmount || 0,
                        averageOrderValue: orderStats._avg.totalAmount || 0,
                        ordersToday,
            revenueToday: orderStats._sum.totalAmount || 0,
                    },
                    products: {
                        total: products,
                        outOfStock: outOfStockProducts,
            lowStock: lowStockProducts,
          },
                };

                return stats;
            },
            300
        );

        res.json({
            status: 'success',
      data: result,
        });
    } catch (error) {
        console.error('Error in getDashboardStats:', error);
        res.status(500).json({
            status: 'error',
      message: 'Failed to fetch dashboard stats',
        });
    }
};

export const getOrderAnalytics = async (req: Request, res: Response): Promise<void> => {
    try {
        const { startDate } = req.query;
        
    const startDateTime =
      startDate && typeof startDate === 'string'
        ? new Date(startDate)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const endDateTime = new Date(); // Always end at current time
        
        const periodDuration = endDateTime.getTime() - startDateTime.getTime();
        const previousPeriodStart = new Date(startDateTime.getTime() - periodDuration);
        const previousPeriodEnd = new Date(startDateTime.getTime());

        const result = await cacheWrapper(
            `${CACHE_KEYS.ORDER_ANALYTICS}:${startDate || 'default'}`,
            async () => {
                const [
                    totalOrders,
                    totalRevenue,
                    averageOrderValue,
                    statusDistribution,
                    dailyOrders,
                    topProducts,
                    paymentMethodStats,
                    customerStats,
                    hourlyDistribution,
                    couponStats,
                    previousPeriodStats,
                    locationStats,
          deliveryStats,
                ] = await Promise.all([
                    prisma.order.count({
                        where: {
                            createdAt: {
                                gte: startDateTime,
                lte: endDateTime,
              },
            },
                    }),

                    prisma.order.aggregate({
                        where: {
                            createdAt: {
                                gte: startDateTime,
                lte: endDateTime,
              },
                        },
            _sum: { totalAmount: true },
                    }),

                    prisma.order.aggregate({
                        where: {
                            createdAt: {
                                gte: startDateTime,
                lte: endDateTime,
              },
                        },
            _avg: { totalAmount: true },
                    }),
                    
                    prisma.order.groupBy({
                        by: ['status'],
                        where: {
                            createdAt: {
                                gte: startDateTime,
                lte: endDateTime,
              },
                        },
            _count: true,
                    }),

                    prisma.order.groupBy({
                        by: ['createdAt'],
                        where: {
                            createdAt: {
                                gte: startDateTime,
                lte: endDateTime,
              },
                        },
                        _count: true,
            _sum: { totalAmount: true },
                    }),

                    prisma.orderItem.groupBy({
                        by: ['productId'],
                        where: {
                            order: {
                                createdAt: {
                                    gte: startDateTime,
                  lte: endDateTime,
                },
              },
                        },
                        _sum: {
                            quantity: true,
              price: true,
                        },
                        orderBy: {
                            _sum: {
                quantity: 'desc',
              },
                        },
            take: 10,
                    }),

                    prisma.order.groupBy({
                        by: ['paymentMethod'],
                        where: {
                            createdAt: {
                                gte: startDateTime,
                lte: endDateTime,
              },
                        },
                        _count: true,
                        _sum: {
              totalAmount: true,
            },
                    }),

                    prisma.order.groupBy({
                        by: ['userId'],
                        where: {
                            createdAt: {
                                gte: startDateTime,
                lte: endDateTime,
              },
                        },
                        _count: true,
                        _sum: {
              totalAmount: true,
            },
                    }),

                    prisma.order.groupBy({
                        by: ['createdAt'],
                        where: {
                            createdAt: {
                                gte: startDateTime,
                lte: endDateTime,
              },
                        },
            _count: true,
                    }),

                    prisma.order.findMany({
                        where: {
                            createdAt: {
                                gte: startDateTime,
                lte: endDateTime,
                            },
                            NOT: {
                couponId: null,
              },
                        },
                        select: {
                            couponId: true,
                            discountAmount: true,
              totalAmount: true,
            },
                    }),

                    prisma.order.aggregate({
                        where: {
                            createdAt: {
                                gte: previousPeriodStart,
                lt: previousPeriodEnd,
              },
                        },
                        _count: true,
                        _sum: {
              totalAmount: true,
            },
                    }),

                    prisma.order.groupBy({
                        by: ['shippingAddressId'],
                        where: {
                            createdAt: {
                                gte: startDateTime,
                lte: endDateTime,
              },
                        },
                        _count: true,
                        _sum: {
              totalAmount: true,
            },
                    }),

                    prisma.order.findMany({
                        where: {
                            createdAt: {
                                gte: startDateTime,
                lte: endDateTime,
                            },
                            status: OrderStatus.DELIVERED,
                            deliveredAt: {
                not: null,
              },
                        },
                        select: {
                            shippingAddressId: true,
                            createdAt: true,
              deliveredAt: true,
            },
          }),
                ]);

                const topProductDetails = await prisma.product.findMany({
                    where: {
                        id: {
              in: topProducts.map((p) => p.productId),
            },
                    },
                    select: {
                        id: true,
                        name: true,
                        price: true,
            category: true,
          },
                });

        const addressIds = locationStats.map((stat) => stat.shippingAddressId);
                const addresses = await prisma.address.findMany({
                    where: {
                        id: {
              in: addressIds,
            },
          },
                });

                const stateStats = new Map();
                const cityStats = new Map();
                const pincodeStats = new Map();

        locationStats.forEach((stat) => {
          const address = addresses.find((a) => a.id === stat.shippingAddressId);
          if (!address) {
            return;
          }

                    const stateKey = address.state;
                    const stateData = stateStats.get(stateKey) || { orders: 0, revenue: 0 };
                    stateData.orders += stat._count;
                    stateData.revenue += stat._sum.totalAmount || 0;
                    stateStats.set(stateKey, stateData);

                    const cityKey = `${address.city}-${address.state}`;
                    const cityData = cityStats.get(cityKey) || { 
                        city: address.city,
                        state: address.state,
                        orders: 0,
            revenue: 0,
                    };
                    cityData.orders += stat._count;
                    cityData.revenue += stat._sum.totalAmount || 0;
                    cityStats.set(cityKey, cityData);

                    const pincodeKey = address.pincode;
                    const pincodeData = pincodeStats.get(pincodeKey) || {
                        pincode: address.pincode,
                        city: address.city,
                        state: address.state,
                        orders: 0,
            deliveryTimes: [],
                    };
                    pincodeData.orders += stat._count;
                    pincodeStats.set(pincodeKey, pincodeData);
                });

        deliveryStats.forEach((order) => {
          const address = addresses.find((a) => a.id === order.shippingAddressId);
          if (!address || !order.deliveredAt) {
            return;
          }

                    const pincodeData = pincodeStats.get(address.pincode);
                    if (pincodeData) {
                        const deliveryTime = order.deliveredAt.getTime() - order.createdAt.getTime();
                        pincodeData.deliveryTimes.push(deliveryTime);
                    }
                });

        pincodeStats.forEach((data) => {
                    if (data.deliveryTimes.length > 0) {
            const avgTime =
              data.deliveryTimes.reduce((a: number, b: number) => a + b, 0) /
              data.deliveryTimes.length;
                        data.averageDeliveryTime = Math.round(avgTime / (1000 * 60 * 60 * 24));
                    }
                    delete data.deliveryTimes;
                });

                const hourlyOrderCounts = new Array(24).fill(0);
        hourlyDistribution.forEach((order) => {
                    const hour = new Date(order.createdAt).getHours();
                    hourlyOrderCounts[hour] += order._count;
                });

                const totalCustomers = customerStats.length;
        const repeatCustomers = customerStats.filter((c) => c._count > 1).length;
        const averageOrdersPerCustomer =
          customerStats.reduce((acc, curr) => acc + curr._count, 0) / totalCustomers;
        const customerLifetimeValue =
          customerStats.reduce((acc, curr) => acc + (curr._sum.totalAmount || 0), 0) /
          totalCustomers;

                const currentPeriodRevenue = totalRevenue._sum.totalAmount || 0;
                const previousPeriodRevenue = previousPeriodStats._sum.totalAmount || 0;
        const revenueGrowth =
          ((currentPeriodRevenue - previousPeriodRevenue) / previousPeriodRevenue) * 100;
        const orderGrowth =
          ((totalOrders - previousPeriodStats._count) / previousPeriodStats._count) * 100;

                const analytics: IOrderAnalytics = {
                    totalOrders,
                    totalRevenue: totalRevenue._sum.totalAmount || 0,
                    averageOrderValue: averageOrderValue._avg.totalAmount || 0,
          statusDistribution: statusDistribution.map((item) => ({
                        status: item.status,
            count: item._count,
                    })),
          dailyOrders: dailyOrders.map((day) => ({
                        date: day.createdAt,
                        orders: day._count,
            revenue: day._sum.totalAmount || 0,
                    })),
          topProducts: topProducts.map((product) => ({
                        productId: product.productId,
                        quantity: product._sum.quantity || 0,
                        revenue: product._sum.price || 0,
            productDetails: topProductDetails.find((p) => p.id === product.productId),
                    })),
                    paymentAnalytics: {
            methodDistribution: paymentMethodStats.map((item) => ({
                            method: item.paymentMethod,
                            count: item._count,
              volume: item._sum.totalAmount || 0,
            })),
                    },
                    customerAnalytics: {
                        totalCustomers,
                        repeatCustomers,
                        repeatCustomerRate: (repeatCustomers / totalCustomers) * 100,
                        averageOrdersPerCustomer,
            customerLifetimeValue,
                    },
                    timeAnalytics: {
                        hourlyDistribution: hourlyOrderCounts,
            peakHour: hourlyOrderCounts.indexOf(Math.max(...hourlyOrderCounts)),
                    },
                    promotionAnalytics: {
                        couponUsage: couponStats.length,
                        totalDiscount: couponStats.reduce((acc, curr) => acc + (curr.discountAmount || 0), 0),
            averageDiscount:
              couponStats.reduce((acc, curr) => acc + (curr.discountAmount || 0), 0) /
                couponStats.length || 0,
                    },
                    growthAnalytics: {
                        revenueGrowth,
                        orderGrowth,
                        previousPeriodRevenue,
            previousPeriodOrders: previousPeriodStats._count,
                    },
                    locationAnalytics: {
                        stateDistribution: Array.from(stateStats.entries()).map(([state, data]) => ({
                            state,
                            orders: data.orders,
              revenue: data.revenue,
                        })),
                        cityDistribution: Array.from(cityStats.values()),
                        topCities: Array.from(cityStats.values())
                            .sort((a: { orders: number }, b: { orders: number }) => b.orders - a.orders)
                            .slice(0, 10),
            deliveryZones: Array.from(pincodeStats.values()),
          },
                };

                return analytics;
            },
            300
        );

        res.json({
            status: 'success',
      data: result,
        });
    } catch (error) {
        console.error('Error in getOrderAnalytics:', error);
        res.status(500).json({
            status: 'error',
      message: 'Failed to fetch order analytics',
        });
    }
};
