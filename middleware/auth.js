const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Therapist = require('../models/Therapist');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'Access token required' 
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (decoded.userType === 'user') {
      const user = await User.findById(decoded.userId);
      if (!user || !user.isActive) {
        return res.status(401).json({ 
          success: false, 
          message: 'User not found or inactive' 
        });
      }
      req.user = user;
      req.userType = 'user';
    } else if (decoded.userType === 'therapist') {
      const therapist = await Therapist.findById(decoded.therapistId);
      if (!therapist || !therapist.isActive) {
        return res.status(401).json({ 
          success: false, 
          message: 'Therapist not found or inactive' 
        });
      }
      req.therapist = therapist;
      req.userType = 'therapist';
    } else {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid token' 
      });
    }

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(403).json({ 
      success: false, 
      message: 'Invalid or expired token' 
    });
  }
};

module.exports = { authenticateToken };