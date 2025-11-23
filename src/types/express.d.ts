import { Role } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      id?: string;
      requestId?: string;
      user?: {
        id: string;
        role: Role;
      };
    }
  }
}

export {};
