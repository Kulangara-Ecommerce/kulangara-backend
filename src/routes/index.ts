import { Router } from 'express';
import authRouter from './auth.route';
import userRouter from './user.route';
import productRouter from './product.route';
import categoryRouter from './category.route';
import cartRouter from './cart.route';
import wishlistRouter from './wishlist.route';
import orderRouter from './order.route';
import adminRouter from './admin.route';
import couponRouter from './coupon.route';
import paymentRouter from './payment.route';
import stockRouter from './stock.route';
import contactRouter from './contact.route';

const router = Router();

router.use('/auth', authRouter);
router.use('/users', userRouter);
router.use('/products', productRouter);
router.use('/categories', categoryRouter);
router.use('/coupons', couponRouter);
router.use('/cart', cartRouter);
router.use('/wishlist', wishlistRouter);
router.use('/orders', orderRouter);
router.use('/admin', adminRouter);
router.use('/payments', paymentRouter);
router.use('/stock', stockRouter);
router.use('/contact', contactRouter);

export default router;
