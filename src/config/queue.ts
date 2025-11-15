import { Queue } from 'bullmq';
import redis from './redis';

export const createQueue = (name: string): Queue => {
  return new Queue(name, {
    connection: redis,
  });
};
