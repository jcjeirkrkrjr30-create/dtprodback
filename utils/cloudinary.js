const cloudinary = require('cloudinary').v2;
const { config } = require('../config');

cloudinary.config({
  cloud_name: config.cloudinary.cloud_name,
  api_key: config.cloudinary.api_key,
  api_secret: config.cloudinary.api_secret,
});

module.exports = {
  uploadToCloudinary: async (imageData, isBase64 = true) => {
    try {
      let result;
      if (isBase64 && imageData.startsWith('data:image')) {
        // Handle base64 image
        result = await cloudinary.uploader.upload(imageData, {
          folder: 'rent_website',
          resource_type: 'auto',
        });
      } else {
        // Handle file path or buffer (for potential file uploads)
        result = await cloudinary.uploader.upload(imageData, {
          folder: 'rent_website',
          resource_type: 'auto',
        });
      }
      return result.secure_url;
    } catch (error) {
      console.error('Cloudinary upload error:', error);
      throw new Error('Failed to upload image to Cloudinary');
    }
  },
};