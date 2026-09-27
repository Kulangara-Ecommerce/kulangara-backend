import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { getRedisConnectionOptions } from './redis';

// BullMQ's Worker uses blocking Redis commands internally, so it needs its
// own connection with maxRetriesPerRequest disabled — sharing the general
// cache connection would risk stalling unrelated cache reads/writes behind it.
export const bullmqConnection = new Redis({
  ...getRedisConnectionOptions(),
  maxRetriesPerRequest: null,
});

export const createQueue = (name: string): Queue => {
  return new Queue(name, {
    connection: bullmqConnection,
  });
};
