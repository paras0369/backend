const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const Therapist = require('../models/Therapist');

const router = express.Router();

router.get('/available', authenticateToken, async (req, res) => {
  try {
    if (req.userType !== 'user') {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    const therapists = await Therapist.find({
      isAvailable: true,
      isActive: true,
    }).select('_id name specialization');

    res.json({
      success: true,
      therapists,
    });
  } catch (error) {
    console.error('Get available therapists error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get therapists',
    });
  }
});

router.get('/profile', authenticateToken, async (req, res) => {
  try {
    if (req.userType !== 'therapist') {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    const therapist = await Therapist.findById(req.therapist._id).select(
      '-__v',
    );

    res.json({
      success: true,
      therapist,
    });
  } catch (error) {
    console.error('Get therapist profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile',
    });
  }
});

router.patch('/status', authenticateToken, async (req, res) => {
  try {
    if (req.userType !== 'therapist') {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    const { isAvailable } = req.body;

    if (typeof isAvailable !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isAvailable must be a boolean',
      });
    }

    const therapist = await Therapist.findByIdAndUpdate(
      req.therapist._id,
      { isAvailable },
      { new: true },
    ).select('-__v');

    res.json({
      success: true,
      therapist,
    });
  } catch (error) {
    console.error('Update therapist status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update status',
    });
  }
});

module.exports = router;
