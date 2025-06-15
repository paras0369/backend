const express = require('express');
const jwt = require('jsonwebtoken');
const twilio = require('twilio');
const User = require('../models/User');
const Therapist = require('../models/Therapist');
const { 
  validatePhoneNumber, 
  validateOTP, 
  checkOTPRateLimit 
} = require('../utils/validation');

const router = express.Router();

// Add error checking for Twilio credentials
if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
  console.warn('Twilio credentials are missing. SMS functionality will be limited to development mode.');
}

let twilioClient = null;
try {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    console.log('Twilio client initialized successfully');
  }
} catch (error) {
  console.error('Failed to initialize Twilio client:', error.message);
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const otpStore = new Map();

router.post('/send-otp', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    console.log('Received phone number:', phoneNumber);

    // Validate phone number
    const phoneValidation = validatePhoneNumber(phoneNumber);
    if (!phoneValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: phoneValidation.message,
      });
    }

    // Check rate limiting
    const rateLimitCheck = checkOTPRateLimit(phoneValidation.cleaned, otpStore);
    if (!rateLimitCheck.isValid) {
      return res.status(429).json({
        success: false,
        message: rateLimitCheck.message,
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    otpStore.set(phoneValidation.cleaned, {
      otp,
      timestamp: Date.now(),
      attempts: 0,
    });

    // Always log OTP in development mode
    console.log(`[Development] OTP for ${phoneNumber}: ${otp}`);

    // Only attempt to send SMS if we're in production AND have valid Twilio credentials
    if (process.env.NODE_ENV === 'production' && twilioClient) {
      try {
        const formattedPhoneNumber = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
        await twilioClient.messages.create({
          body: `Your TherapyCall verification code is: ${otp}`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: formattedPhoneNumber,
        });
      } catch (twilioError) {
        console.error('Twilio API error:', twilioError);
        // Still return success since we're storing the OTP
        return res.json({
          success: true,
          message: 'OTP generated successfully (SMS delivery failed)',
          devMode: true
        });
      }
    }

    res.json({
      success: true,
      message: 'OTP sent successfully',
      devMode: process.env.NODE_ENV !== 'production'
    });
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP',
      error: error.message
    });
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;

    // Validate inputs
    const phoneValidation = validatePhoneNumber(phoneNumber);
    if (!phoneValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: phoneValidation.message,
      });
    }

    const otpValidation = validateOTP(otp);
    if (!otpValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: otpValidation.message,
      });
    }

    const storedOTP = otpStore.get(phoneValidation.cleaned);

    if (!storedOTP) {
      return res.status(400).json({
        success: false,
        message: 'OTP not found or expired',
      });
    }

    if (Date.now() - storedOTP.timestamp > 300000) {
      otpStore.delete(phoneValidation.cleaned);
      return res.status(400).json({
        success: false,
        message: 'OTP expired',
      });
    }

    if (storedOTP.otp !== otp) {
      storedOTP.attempts += 1;

      if (storedOTP.attempts >= 3) {
        otpStore.delete(phoneValidation.cleaned);
        return res.status(400).json({
          success: false,
          message: 'Too many failed attempts',
        });
      }

      return res.status(400).json({
        success: false,
        message: 'Invalid OTP',
      });
    }

    otpStore.delete(phoneValidation.cleaned);

    let user = await User.findOne({ phoneNumber: phoneValidation.cleaned });
    if (!user) {
      user = new User({ phoneNumber: phoneValidation.cleaned });
      await user.save();
    }

    const token = jwt.sign({ userId: user._id, userType: 'user' }, JWT_SECRET, {
      expiresIn: '30d',
    });

    res.json({
      success: true,
      token,
      userId: user._id,
      message: 'Login successful',
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP',
    });
  }
});

router.post('/therapist-login', async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required',
      });
    }

    const therapist = await Therapist.findOne({ phoneNumber, isActive: true });

    if (!therapist) {
      return res.status(401).json({
        success: false,
        message: 'Invalid phone number or account not active',
      });
    }

    const token = jwt.sign(
      { therapistId: therapist._id, userType: 'therapist' },
      JWT_SECRET,
      { expiresIn: '30d' },
    );

    res.json({
      success: true,
      token,
      therapistId: therapist._id,
      message: 'Login successful',
    });
  } catch (error) {
    console.error('Therapist login error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to login',
    });
  }
});

module.exports = router;
