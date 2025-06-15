const validator = require('validator');

// Phone number validation
const validatePhoneNumber = (phoneNumber) => {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return { isValid: false, message: 'Phone number is required' };
  }
  
  // Remove spaces, dashes, parentheses
  const cleaned = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
  
  // Check if it's a valid mobile number (10-15 digits)
  if (!/^\d{10,15}$/.test(cleaned)) {
    return { isValid: false, message: 'Invalid phone number format' };
  }
  
  return { isValid: true, cleaned: cleaned };
};

// OTP validation
const validateOTP = (otp) => {
  if (!otp || typeof otp !== 'string') {
    return { isValid: false, message: 'OTP is required' };
  }
  
  if (!/^\d{6}$/.test(otp)) {
    return { isValid: false, message: 'OTP must be 6 digits' };
  }
  
  return { isValid: true };
};

// Sanitize input
const sanitizeInput = (input, maxLength = 255) => {
  if (!input || typeof input !== 'string') return '';
  
  return validator.escape(input.trim()).substring(0, maxLength);
};

// Validate ObjectId
const validateObjectId = (id) => {
  if (!id || typeof id !== 'string') {
    return { isValid: false, message: 'ID is required' };
  }
  
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    return { isValid: false, message: 'Invalid ID format' };
  }
  
  return { isValid: true };
};

// Rate limit check for OTP requests
const checkOTPRateLimit = (phoneNumber, otpStore) => {
  const stored = otpStore.get(phoneNumber);
  
  if (stored && (Date.now() - stored.timestamp) < 60000) { // 1 minute
    return { 
      isValid: false, 
      message: 'Please wait 1 minute before requesting another OTP' 
    };
  }
  
  return { isValid: true };
};

module.exports = {
  validatePhoneNumber,
  validateOTP,
  sanitizeInput,
  validateObjectId,
  checkOTPRateLimit
};