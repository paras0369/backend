const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const Call = require('../models/Call');
const User = require('../models/User');
const Therapist = require('../models/Therapist');

const router = express.Router();

router.post('/start', authenticateToken, async (req, res) => {
  try {
    if (req.userType !== 'user') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    const { therapistId } = req.body;

    if (!therapistId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Therapist ID is required' 
      });
    }

    const therapist = await Therapist.findById(therapistId);
    if (!therapist || !therapist.isAvailable) {
      return res.status(400).json({ 
        success: false, 
        message: 'Therapist not available' 
      });
    }

    const user = await User.findById(req.user._id);
    if (user.coins < 6) {
      return res.status(400).json({ 
        success: false, 
        message: 'Insufficient coins' 
      });
    }

    const call = new Call({
      userId: req.user._id,
      therapistId,
      startTime: new Date(),
      status: 'initiated'
    });

    await call.save();

    res.json({ 
      success: true, 
      callId: call._id,
      message: 'Call initiated' 
    });
  } catch (error) {
    console.error('Start call error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to start call' 
    });
  }
});

router.post('/end', authenticateToken, async (req, res) => {
  try {
    const { callId, duration } = req.body;

    if (!callId || typeof duration !== 'number') {
      return res.status(400).json({ 
        success: false, 
        message: 'Call ID and duration are required' 
      });
    }

    const call = await Call.findById(callId);
    if (!call) {
      return res.status(404).json({ 
        success: false, 
        message: 'Call not found' 
      });
    }

    if (req.userType === 'user' && call.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    if (req.userType === 'therapist' && call.therapistId.toString() !== req.therapist._id.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    const userCost = duration * 6;
    let therapistEarnings = duration * 2;
    
    if (duration >= 10) {
      therapistEarnings = duration * 2.5;
    }

    call.endTime = new Date();
    call.duration = duration;
    call.userCost = userCost;
    call.therapistEarnings = therapistEarnings;
    call.status = 'completed';

    await call.save();

    await Promise.all([
      User.findByIdAndUpdate(call.userId, { 
        $inc: { coins: -userCost } 
      }),
      Therapist.findByIdAndUpdate(call.therapistId, { 
        $inc: { totalEarnings: therapistEarnings } 
      })
    ]);

    res.json({ 
      success: true, 
      call,
      message: 'Call ended successfully' 
    });
  } catch (error) {
    console.error('End call error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to end call' 
    });
  }
});

router.get('/history', authenticateToken, async (req, res) => {
  try {
    let query = {};
    let populateField = '';

    if (req.userType === 'user') {
      query = { userId: req.user._id, status: 'completed' };
      populateField = 'therapistId';
    } else if (req.userType === 'therapist') {
      query = { therapistId: req.therapist._id, status: 'completed' };
      populateField = 'userId';
    } else {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    const calls = await Call.find(query)
      .populate(populateField, 'name phoneNumber')
      .sort({ createdAt: -1 })
      .limit(50);

    const formattedCalls = calls.map(call => ({
      id: call._id,
      startTime: call.startTime,
      endTime: call.endTime,
      duration: call.duration,
      earnings: req.userType === 'therapist' ? call.therapistEarnings : null,
      cost: req.userType === 'user' ? call.userCost : null,
      userName: req.userType === 'therapist' ? call.userId?.phoneNumber : null,
      therapistName: req.userType === 'user' ? call.therapistId?.name : null,
    }));

    res.json({ 
      success: true, 
      calls: formattedCalls 
    });
  } catch (error) {
    console.error('Get call history error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get call history' 
    });
  }
});

module.exports = router;