const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

router.get('/profile', authenticateToken, async (req, res) => {
  try {
    if (req.userType !== 'user') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    const user = await User.findById(req.user._id).select('-__v');
    
    res.json({ 
      success: true, 
      user 
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get profile' 
    });
  }
});

router.patch('/profile', authenticateToken, async (req, res) => {
  try {
    if (req.userType !== 'user') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    const updates = req.body;
    delete updates.coins;
    delete updates._id;
    delete updates.createdAt;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true, runValidators: true }
    ).select('-__v');

    res.json({ 
      success: true, 
      user 
    });
  } catch (error) {
    console.error('Update user profile error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update profile' 
    });
  }
});

module.exports = router;