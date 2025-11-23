import { Request, Response } from 'express';
import { prisma } from '../config/db';
import bcrypt from 'bcryptjs';
import { IUserUpdate, IAddressCreate, IAddressUpdate } from '../types/user.types';

export const getProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user?.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatar: true,
        role: true,
        isVerified: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
      return;
    }

    res.json({
      status: 'success',
      data: { user },
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
};

export const updateProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const updateData: IUserUpdate = req.body;

    const user = await prisma.user.update({
      where: { id: req.user?.id },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatar: true,
        role: true,
        isVerified: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({
      status: 'success',
      message: 'Profile updated successfully',
      data: { user },
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
};

export const deleteAccount = async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.user.delete({
      where: { id: req.user?.id },
    });

    res.json({
      status: 'success',
      message: 'Account deleted successfully',
    });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
};

export const changePassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: req.user?.id },
      select: { password: true },
    });

    if (!user) {
      res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
      return;
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      res.status(401).json({
        status: 'error',
        message: 'Current password is incorrect',
      });
      return;
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await prisma.user.update({
      where: { id: req.user?.id },
      data: { password: hashedPassword },
    });

    // Invalidate all refresh tokens
    await prisma.refreshToken.deleteMany({
      where: { userId: req.user?.id },
    });

    res.json({
      status: 'success',
      message: 'Password changed successfully',
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
};

export const getAddresses = async (req: Request, res: Response): Promise<void> => {
  try {
    const addresses = await prisma.address.findMany({
      where: { userId: req.user?.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });

    res.json({
      status: 'success',
      data: { addresses },
    });
  } catch (error) {
    console.error('Get addresses error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
};

export const createAddress = async (req: Request, res: Response): Promise<void> => {
  try {
    const addressData: IAddressCreate = req.body;

    // If this is the first address or isDefault is true, unset other default addresses
    if (addressData.isDefault) {
      await prisma.address.updateMany({
        where: { userId: req.user?.id },
        data: { isDefault: false },
      });
    }

    const address = await prisma.address.create({
      data: {
        ...addressData,
        userId: req.user!.id,
      },
    });

    res.status(201).json({
      status: 'success',
      message: 'Address created successfully',
      data: { address },
    });
  } catch (error) {
    console.error('Create address error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
};

export const updateAddress = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updateData: IAddressUpdate = req.body;

    // Check if address exists and belongs to user
    const existingAddress = await prisma.address.findFirst({
      where: {
        id,
        userId: req.user?.id,
      },
    });

    if (!existingAddress) {
      res.status(404).json({
        status: 'error',
        message: 'Address not found',
      });
      return;
    }

    // If setting as default, unset other default addresses
    if (updateData.isDefault) {
      await prisma.address.updateMany({
        where: {
          userId: req.user?.id,
          id: { not: id },
        },
        data: { isDefault: false },
      });
    }

    const address = await prisma.address.update({
      where: { id },
      data: updateData,
    });

    res.json({
      status: 'success',
      message: 'Address updated successfully',
      data: { address },
    });
  } catch (error) {
    console.error('Update address error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
};

export const deleteAddress = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Check if address exists and belongs to user
    const address = await prisma.address.findFirst({
      where: {
        id,
        userId: req.user?.id,
      },
    });

    if (!address) {
      res.status(404).json({
        status: 'error',
        message: 'Address not found',
      });
      return;
    }

    await prisma.address.delete({
      where: { id },
    });

    res.json({
      status: 'success',
      message: 'Address deleted successfully',
    });
  } catch (error) {
    console.error('Delete address error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
};

export const setDefaultAddress = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Check if address exists and belongs to user
    const address = await prisma.address.findFirst({
      where: {
        id,
        userId: req.user?.id,
      },
    });

    if (!address) {
      res.status(404).json({
        status: 'error',
        message: 'Address not found',
      });
      return;
    }

    // Unset other default addresses
    await prisma.address.updateMany({
      where: {
        userId: req.user?.id,
        id: { not: id },
      },
      data: { isDefault: false },
    });

    // Set this address as default
    const updatedAddress = await prisma.address.update({
      where: { id },
      data: { isDefault: true },
    });

    res.json({
      status: 'success',
      message: 'Default address updated successfully',
      data: { address: updatedAddress },
    });
  } catch (error) {
    console.error('Set default address error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
};
