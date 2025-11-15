import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import createError from 'http-errors';
import { env } from './env';
import { logger } from '../utils/logger';
import { FILE_UPLOAD } from '../constants';

export const s3Client = new S3Client({
  region: env.AWS_REGION,
    credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
});

export const BUCKET_NAME = env.AWS_BUCKET_NAME;

export const generateUploadURL = async (key: string, contentType: string): Promise<string> => {
    try {
        const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
            ContentType: contentType,
        });

    const uploadURL = await getSignedUrl(s3Client, command, {
      expiresIn: FILE_UPLOAD.S3_PRESIGNED_URL_EXPIRY,
    });
        return uploadURL;
    } catch (error) {
    logger.error({ err: error, key, contentType }, 'Error generating upload URL');
        throw createError(500, 'Failed to generate upload URL');
    }
};

export const deleteFile = async (key: string): Promise<void> => {
    try {
        const command = new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        });

        await s3Client.send(command);
    } catch (error) {
    logger.error({ err: error, key }, 'Error deleting file from S3');
        throw createError(500, 'Failed to delete file from S3');
    }
};
