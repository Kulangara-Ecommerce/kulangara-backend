import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { asyncHandler } from '../utils/asyncHandler';

export const submitContact = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { name, email, message, phone } = req.body;
  const userId = req.user?.id;

  const contact = await prisma.contactMessage.create({
    data: {
      name,
      email,
      message,
      phone,
      userId,
    },
  });

  res.status(201).json({
    status: 'success',
    message: 'Thanks for reaching out!',
    data: {
      id: contact.id,
      ticketId: contact.id,
      message: 'Thanks for reaching out!',
    },
  });
});

export const listContactMessages = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const page = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
  const limit = Number(req.query.limit) > 0 ? Math.min(Number(req.query.limit), 100) : 20;
  const skip = (page - 1) * limit;

  const [items, total] = await prisma.$transaction([
    prisma.contactMessage.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    }),
    prisma.contactMessage.count(),
  ]);

  res.json({
    status: 'success',
    data: {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    },
  });
});

