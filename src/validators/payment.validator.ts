import { z } from 'zod';

export const createRazorpayOrderSchema = z.object({
  body: z.object({
    orderId: z.string(),
  }),
});

export const createRazorpayOrderFromCartSchema = z.object({
  body: z.object({
    cartData: z.object({
      items: z.array(
        z.object({
          productId: z.string(),
          variantId: z.string().optional(),
          quantity: z.number().positive(),
          price: z.number().positive(),
        })
      ),
      subtotal: z.number().min(0),
      tax: z.number().min(0),
      discount: z.number().min(0),
      total: z.number().positive(),
      couponCode: z.string().optional(),
      shippingAddressId: z.string(),
    }),
    userEmail: z.string().email().optional(),
    userPhone: z.string().optional(),
  }),
});

export const verifyPaymentSchema = z.object({
  body: z.object({
    razorpay_order_id: z.string(),
    razorpay_payment_id: z.string(),
    razorpay_signature: z.string(),
  }),
});

export const verifyPaymentWithCartSchema = z.object({
  body: z.object({
    razorpay_order_id: z.string(),
    razorpay_payment_id: z.string(),
    razorpay_signature: z.string(),
    cartData: z.object({
      items: z.array(
        z.object({
          productId: z.string(),
          variantId: z.string().optional(),
          quantity: z.number().positive(),
        })
      ),
      shippingAddressId: z.string(),
      paymentMethod: z.string(),
      couponCode: z.string().optional(),
    }),
  }),
});

export const updatePaymentStatusSchema = z.object({
  body: z.object({
    paymentStatus: z.enum(['PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIAL_REFUND']),
    note: z.string().optional(),
  }),
});
