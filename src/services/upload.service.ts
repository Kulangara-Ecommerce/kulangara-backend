import { v4 as uuidv4 } from 'uuid';
import { generateUploadURL, deleteFile } from '../config/s3';

export const generateProductImageUploadURL = async (fileType: string) => {
  const fileExtension = fileType.split('/')[1];
  const key = `products/${uuidv4()}.${fileExtension}`;
  const uploadURL = await generateUploadURL(key, fileType);
  return { uploadURL, key };
};

export const deleteProductImage = async (imageUrl: string) => {
  // Extract the key from the S3 URL
  const key = imageUrl.split('.com/')[1];
  if (!key) throw new Error('Invalid S3 URL');

  await deleteFile(key);
};
