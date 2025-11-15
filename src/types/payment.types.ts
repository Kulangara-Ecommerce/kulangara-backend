export interface ICreateRazorpayOrderRequest {
  cartData: {
    items: Array<{
      productId: string;
      variantId?: string;
      quantity: number;
      price: number;
    }>;
    subtotal: number;
    tax: number;
    discount: number;
    total: number;
    couponCode?: string;
    shippingAddressId: string;
  };
  userEmail?: string;
  userPhone?: string;
}

export interface IVerifyPaymentWithCartRequest {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
  cartData: {
    items: Array<{
      productId: string;
      variantId?: string;
      quantity: number;
    }>;
    shippingAddressId: string;
    paymentMethod: string;
    couponCode?: string;
  };
}

export interface ICreateRazorpayOrderResponse {
  status: 'success';
  data: {
    orderId: string; // Razorpay order ID (not database order ID)
    amount: number;
    currency: string;
    key: string;
    name: string;
    description: string;
    prefill: {
      email: string;
      contact: string;
    };
    theme: {
      color: string;
    };
  };
}

export interface IVerifyPaymentWithCartResponse {
  status: 'success';
  message: string;
  data: {
    verified: boolean;
    paymentId: string;
    orderId: string; // Database order ID (created only after successful payment)
  };
}

export interface ITemporaryOrderData {
  razorpayOrderId: string;
  cartData: {
    items: Array<{
      productId: string;
      variantId?: string;
      quantity: number;
      price: number;
    }>;
    subtotal: number;
    tax: number;
    discount: number;
    total: number;
    couponCode?: string;
    shippingAddressId: string;
  };
  userId: string;
  userEmail?: string;
  userPhone?: string;
  createdAt: Date;
  expiresAt: Date;
}
