const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Therapist = require('../models/Therapist');
const Call = require('../models/Call');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

const connectedUsers = new Map();
const activeCalls = new Map();
const callAcceptanceTracker = new Map(); // Track who is trying to accept calls

// Clean up stale acceptance trackers every 30 seconds
setInterval(() => {
  const now = Date.now();
  const ACCEPTANCE_TIMEOUT = 30000; // 30 seconds
  
  for (const [key, value] of callAcceptanceTracker) {
    if (now - value.timestamp > ACCEPTANCE_TIMEOUT) {
      console.log('Cleaning up stale acceptance tracker:', key);
      callAcceptanceTracker.delete(key);
    }
  }
}, 30000);

const socketHandler = (io) => {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      const decoded = jwt.verify(token, JWT_SECRET);
      
      if (decoded.userType === 'user') {
        const user = await User.findById(decoded.userId);
        if (!user || !user.isActive) {
          return next(new Error('User not found or inactive'));
        }
        socket.user = user;
        socket.userType = 'user';
      } else if (decoded.userType === 'therapist') {
        const therapist = await Therapist.findById(decoded.therapistId);
        if (!therapist || !therapist.isActive) {
          return next(new Error('Therapist not found or inactive'));
        }
        socket.therapist = therapist;
        socket.userType = 'therapist';
      } else {
        return next(new Error('Invalid token'));
      }
      
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`${socket.userType} connected:`, socket.id);
    
    const userId = socket.userType === 'user' ? socket.user._id.toString() : socket.therapist._id.toString();
    const userName = socket.userType === 'user' ? socket.user.phoneNumber : socket.therapist.name;
    const connectionKey = userId; // Use userId as key
    
    console.log(`Adding ${socket.userType} to connected users with Key:`, connectionKey, 'Name:', userName);
    
    // Check if this user is already connected
    const existingConnection = connectedUsers.get(connectionKey);
    if (existingConnection) {
      console.log(`WARNING: User ${userId} already connected with socket ${existingConnection.socketId}, disconnecting old socket and replacing with new socket ${socket.id}`);
      // Disconnect the old socket to prevent duplicate connections
      const oldSocket = io.sockets.sockets.get(existingConnection.socketId);
      if (oldSocket) {
        oldSocket.disconnect(true);
      }
    }
    
    connectedUsers.set(connectionKey, {
      socketId: socket.id,
      userType: socket.userType,
      userId: userId,
      userData: socket.userType === 'user' ? socket.user : socket.therapist
    });
    
    console.log('Current connected users:', Array.from(connectedUsers.entries()).map(([key, data]) => ({ 
      key,
      userId: data.userId,
      type: data.userType, 
      name: data.userType === 'user' ? data.userData.phoneNumber : data.userData.name 
    })));

    socket.on('initiate-call', async (data) => {
      try {
        console.log('Initiate call received:', data);
        console.log('Connected users:', Array.from(connectedUsers.keys()));
        
        if (socket.userType !== 'user') return;

        // Check if this socket is still the active connection for this user
        const userConnectionKey = socket.user._id.toString();
        const activeConnection = connectedUsers.get(userConnectionKey);
        if (!activeConnection || activeConnection.socketId !== socket.id) {
          console.log('Ignoring call initiation from inactive socket:', socket.id);
          return;
        }

        const { therapistId } = data;
        const userId = socket.user._id;

        // Prevent users from calling themselves
        if (userId.toString() === therapistId.toString()) {
          console.log('User trying to call themselves, blocking:', userId);
          socket.emit('call-rejected', { message: 'Cannot call yourself' });
          return;
        }

        // Check for duplicate/existing calls in the last 30 seconds
        const existingCall = await Call.findOne({
          userId: userId,
          therapistId,
          status: { $in: ['initiated', 'accepted'] },
          createdAt: { $gte: new Date(Date.now() - 30000) } // Last 30 seconds
        });

        if (existingCall) {
          console.log('Duplicate call attempt blocked for user:', userId, 'to therapist:', therapistId);
          socket.emit('call-rejected', { message: 'Call already in progress' });
          return;
        }

        // Check if user already has an active call in memory
        for (const [callId, callData] of activeCalls) {
          if (callData.userId === userId.toString()) {
            console.log('User already has active call:', callId);
            socket.emit('call-rejected', { message: 'You already have an active call' });
            return;
          }
        }

        // Find therapist among connected users
        let therapistConnection = null;
        for (const [key, connection] of connectedUsers) {
          if (connection.userId === therapistId && connection.userType === 'therapist') {
            therapistConnection = connection;
            console.log('Found therapist connection:', key);
            break;
          }
        }
        
        console.log('Looking for therapist:', therapistId);
        console.log('Therapist connection found:', !!therapistConnection);
        
        if (!therapistConnection || therapistConnection.userType !== 'therapist') {
          console.log('Therapist not available or not connected');
          socket.emit('call-rejected', { message: 'Therapist not available' });
          return;
        }

        const call = new Call({
          userId: userId,
          therapistId,
          startTime: new Date(),
          status: 'initiated'
        });

        await call.save();

        activeCalls.set(call._id.toString(), {
          callId: call._id.toString(),
          userId: socket.user._id.toString(),
          therapistId,
          userSocketId: socket.id,
          therapistSocketId: therapistConnection.socketId,
          startTime: new Date()
        });

        console.log('Emitting call-request to therapist socket:', therapistConnection.socketId);
        io.to(therapistConnection.socketId).emit('call-request', {
          callId: call._id.toString(),
          userName: socket.user.phoneNumber,
          userId: socket.user._id.toString()
        });
        console.log('Call request sent to therapist');

        // Send the real callId back to the user who initiated the call
        socket.emit('call-initiated', {
          callId: call._id.toString(),
          therapistId,
          status: 'initiated'
        });
        console.log('Call initiated confirmation sent to user with callId:', call._id.toString());

      } catch (error) {
        console.error('Initiate call error:', error);
        socket.emit('call-rejected', { message: 'Failed to initiate call' });
      }
    });

    socket.on('accept-call', async (data) => {
      try {
        console.log('Accept call received:', data, 'from therapist:', socket.therapist?.name);
        
        if (socket.userType !== 'therapist') {
          console.log('Accept call ignored - not from therapist');
          return;
        }

        const { callId } = data;
        
        // Check if this call is already being processed for acceptance
        const acceptanceKey = `${callId}_${socket.therapist._id.toString()}`;
        
        if (callAcceptanceTracker.has(acceptanceKey)) {
          const existingAcceptance = callAcceptanceTracker.get(acceptanceKey);
          console.log('Call acceptance already in progress by socket:', existingAcceptance.socketId, 'current socket:', socket.id);
          socket.emit('call-rejected', { message: 'Call is already being accepted' });
          return;
        }
        
        // Mark this call as being accepted by this socket
        callAcceptanceTracker.set(acceptanceKey, {
          socketId: socket.id,
          timestamp: Date.now()
        });
        
        const callData = activeCalls.get(callId);
        
        console.log('Looking for call in activeCalls:', callId);
        console.log('Call data found:', !!callData);
        console.log('Active calls count:', activeCalls.size);
        console.log('Active calls keys:', Array.from(activeCalls.keys()));
        
        if (!callData) {
          console.log('Call not found in active calls for accept:', callId);
          // Clean up acceptance tracker
          callAcceptanceTracker.delete(acceptanceKey);
          socket.emit('call-rejected', { message: 'Call not found' });
          return;
        }

        // Update database
        await Call.findByIdAndUpdate(callId, { 
          status: 'accepted'
        });

        // Update memory state
        callData.status = 'active';
        callData.acceptedAt = new Date();
        activeCalls.set(callId, callData);

        console.log('Call accepted, sending confirmations for:', callId);
        console.log('User socket:', callData.userSocketId);
        console.log('Therapist socket:', socket.id);

        // Send confirmation to user
        io.to(callData.userSocketId).emit('call-accepted', {
          callId,
          therapistName: socket.therapist.name
        });

        // Send confirmation to therapist
        socket.emit('call-accepted', {
          callId,
          userName: callData.userName || 'User'
        });

        console.log('Call acceptance notifications sent for:', callId);

      } catch (error) {
        console.error('Accept call error:', error);
        socket.emit('call-rejected', { message: 'Failed to accept call' });
      } finally {
        // Clean up acceptance tracker in both success and error cases
        const { callId } = data;
        const cleanupKey = `${callId}_${socket.therapist._id.toString()}`;
        callAcceptanceTracker.delete(cleanupKey);
        console.log('Cleaned up acceptance tracker for:', cleanupKey);
      }
    });

    socket.on('reject-call', async (data) => {
      try {
        const { callId } = data;
        const callData = activeCalls.get(callId);
        
        if (!callData) return;

        await Call.findByIdAndUpdate(callId, { 
          status: 'rejected',
          endTime: new Date()
        });

        io.to(callData.userSocketId).emit('call-rejected', {
          callId,
          message: 'Call was rejected'
        });

        activeCalls.delete(callId);

      } catch (error) {
        console.error('Reject call error:', error);
      }
    });

    // Handle call cancellation by therapist ID (for temp callIds)
    socket.on('cancel-call-request', async (data) => {
      try {
        const { therapistId, reason } = data;
        console.log('Cancel call request received:', data, 'from user:', socket.user?.phoneNumber);
        
        if (socket.userType !== 'user') {
          console.log('Cancel call request ignored - not from user');
          return;
        }

        // Find active call by therapist ID and user ID
        let targetCallId = null;
        let targetCallData = null;

        for (const [callId, callData] of activeCalls) {
          if (callData.userId === socket.user._id.toString() && 
              callData.therapistId === therapistId) {
            targetCallId = callId;
            targetCallData = callData;
            console.log('Found call to cancel:', callId);
            break;
          }
        }

        if (!targetCallId || !targetCallData) {
          console.log('No active call found to cancel for therapist:', therapistId);
          return;
        }

        // Update database
        await Call.findByIdAndUpdate(targetCallId, {
          status: 'cancelled',
          endTime: new Date()
        });

        // Notify therapist that call was cancelled
        if (targetCallData.therapistSocketId) {
          io.to(targetCallData.therapistSocketId).emit('call-cancelled', {
            callId: targetCallId,
            reason: reason || 'user cancelled the call',
            cancelledBy: 'user'
          });
          console.log('Sent call cancellation to therapist socket:', targetCallData.therapistSocketId);
        }

        // Clean up active call
        activeCalls.delete(targetCallId);
        console.log('Call cancelled successfully:', targetCallId);

      } catch (error) {
        console.error('Cancel call request error:', error);
      }
    });

    socket.on('end-call', async (data) => {
      try {
        const { callId, duration, endedBy } = data;
        const callData = activeCalls.get(callId);
        
        if (!callData) {
          console.log(`End call ignored - callId ${callId} not found in active calls`);
          console.log('Current active calls:', Array.from(activeCalls.keys()));
          console.log('Active calls count:', activeCalls.size);
          return;
        }

        console.log(`Processing end-call for ${callId} by ${socket.userType}`);
        console.log('Call data:', callData);

        // Check if call was accepted or still in ringing state
        const call = await Call.findById(callId);
        if (!call) {
          console.log(`End call ignored - callId ${callId} not found in database`);
          activeCalls.delete(callId); // Clean up stale entry
          return;
        }

        // Check if call was already processed
        if (['cancelled', 'completed', 'rejected'].includes(call.status)) {
          console.log(`End call ignored - call ${callId} already has status: ${call.status}`);
          activeCalls.delete(callId); // Clean up stale entry
          return;
        }

        const userType = socket.userType;
        console.log(`Processing end-call for ${callId} by ${userType}, current status: ${call.status}`);

        if (call.status === 'accepted' && callData.acceptedAt) {
          // Handle ending of accepted call
          const actualDuration = duration || Math.ceil((new Date() - callData.acceptedAt) / 60000);
          const userCost = actualDuration * 6;
          let therapistEarnings = actualDuration * 2;
          
          if (actualDuration >= 10) {
            therapistEarnings = actualDuration * 2.5;
          }

          const endReason = userType === 'user' ? 'user ended the call' : 'therapist ended the call';

          await Promise.all([
            Call.findByIdAndUpdate(callId, {
              status: 'completed',
              endTime: new Date(),
              duration: actualDuration,
              userCost,
              therapistEarnings
            }),
            User.findByIdAndUpdate(callData.userId, { 
              $inc: { coins: -userCost } 
            }),
            Therapist.findByIdAndUpdate(callData.therapistId, { 
              $inc: { totalEarnings: therapistEarnings } 
            })
          ]);

          io.to(callData.userSocketId).emit('call-ended', {
            callId,
            duration: actualDuration,
            cost: userCost,
            reason: endReason
          });

          io.to(callData.therapistSocketId).emit('call-ended', {
            callId,
            duration: actualDuration,
            earnings: therapistEarnings,
            reason: endReason
          });

        } else {
          // Handle cancellation of unaccepted call
          const cancelReason = userType === 'user' ? 'user cancelled the call' : 'therapist cancelled the call';

          await Call.findByIdAndUpdate(callId, {
            status: 'cancelled',
            endTime: new Date()
          });

          // Emit call-cancelled event to both parties
          const targetSocketId = userType === 'user' ? callData.therapistSocketId : callData.userSocketId;
          
          if (targetSocketId) {
            io.to(targetSocketId).emit('call-cancelled', {
              callId,
              reason: cancelReason,
              cancelledBy: userType
            });
          }

          // Emit call-ended to the person who cancelled
          socket.emit('call-ended', {
            callId,
            reason: cancelReason
          });
        }

        activeCalls.delete(callId);

      } catch (error) {
        console.error('End call error:', error);
      }
    });

    socket.on('offer', (data) => {
      const { offer, callId } = data;
      const callData = activeCalls.get(callId);
      
      console.log('Received offer for call:', callId);
      console.log('Call data exists:', !!callData);
      console.log('Therapist socket ID:', callData?.therapistSocketId);
      
      if (callData && callData.therapistSocketId) {
        console.log('Forwarding offer to therapist');
        io.to(callData.therapistSocketId).emit('offer', { offer, callId });
      } else {
        console.log('Could not forward offer - call data or therapist socket missing');
      }
    });

    socket.on('answer', (data) => {
      const { answer, callId } = data;
      const callData = activeCalls.get(callId);
      
      console.log('Received answer for call:', callId);
      console.log('Call data exists:', !!callData);
      console.log('User socket ID:', callData?.userSocketId);
      
      if (callData && callData.userSocketId) {
        console.log('Forwarding answer to user');
        io.to(callData.userSocketId).emit('answer', { answer, callId });
      } else {
        console.log('Could not forward answer - call data or user socket missing');
      }
    });

    socket.on('ice-candidate', (data) => {
      const { candidate, callId } = data;
      const callData = activeCalls.get(callId);
      
      console.log('Received ICE candidate for call:', callId);
      console.log('From socket:', socket.id);
      
      if (callData) {
        const targetSocketId = socket.id === callData.userSocketId 
          ? callData.therapistSocketId 
          : callData.userSocketId;
        
        console.log('Forwarding ICE candidate to:', targetSocketId);
        
        if (targetSocketId) {
          io.to(targetSocketId).emit('ice-candidate', { candidate, callId });
        } else {
          console.log('No target socket found for ICE candidate');
        }
      } else {
        console.log('No call data found for ICE candidate');
      }
    });

    socket.on('disconnect', async () => {
      console.log(`${socket.userType} disconnected:`, socket.id);
      
      const userId = socket.userType === 'user' ? socket.user._id.toString() : socket.therapist._id.toString();
      const connectionKey = userId;
      
      console.log('Removing connection:', connectionKey);
      connectedUsers.delete(connectionKey);
      
      // Clean up any acceptance tracking for this therapist
      if (socket.userType === 'therapist') {
        for (const [key, value] of callAcceptanceTracker) {
          if (value.socketId === socket.id) {
            console.log('Cleaning up acceptance tracker for disconnected socket:', key);
            callAcceptanceTracker.delete(key);
          }
        }
      }

      for (const [callId, callData] of activeCalls) {
        if (callData.userSocketId === socket.id || callData.therapistSocketId === socket.id) {
          try {
            // Check current call status in database before processing
            const call = await Call.findById(callId);
            if (!call) {
              activeCalls.delete(callId);
              continue;
            }

            // If call was already processed (cancelled, completed, rejected), skip
            if (['cancelled', 'completed', 'rejected'].includes(call.status)) {
              console.log(`Call ${callId} already processed with status: ${call.status}, skipping disconnect handling`);
              activeCalls.delete(callId);
              continue;
            }

            const otherSocketId = callData.userSocketId === socket.id 
              ? callData.therapistSocketId 
              : callData.userSocketId;
            
            // Handle based on call status
            if (call.status === 'accepted' && callData.acceptedAt) {
              // This was an active call that got disconnected
              const duration = Math.ceil((new Date() - callData.acceptedAt) / 60000);
              const userCost = duration * 6;
              let therapistEarnings = duration * 2;
              
              if (duration >= 10) {
                therapistEarnings = duration * 2.5;
              }

              await Promise.all([
                Call.findByIdAndUpdate(callId, {
                  status: 'completed',
                  endTime: new Date(),
                  duration,
                  userCost,
                  therapistEarnings
                }),
                User.findByIdAndUpdate(callData.userId, { 
                  $inc: { coins: -userCost } 
                }),
                Therapist.findByIdAndUpdate(callData.therapistId, { 
                  $inc: { totalEarnings: therapistEarnings } 
                })
              ]);

              if (otherSocketId) {
                const disconnectReason = socket.userType === 'user' ? 
                  'user disconnected' : 'therapist disconnected';
                io.to(otherSocketId).emit('call-ended', {
                  callId,
                  duration,
                  cost: socket.userType === 'therapist' ? userCost : undefined,
                  earnings: socket.userType === 'user' ? therapistEarnings : undefined,
                  reason: disconnectReason
                });
              }
            } else {
              // This was an unaccepted call that got disconnected (cancellation)
              await Call.findByIdAndUpdate(callId, {
                status: 'cancelled',
                endTime: new Date()
              });

              if (otherSocketId) {
                const cancelReason = socket.userType === 'user' ? 
                  'user cancelled the call' : 'therapist cancelled the call';
                io.to(otherSocketId).emit('call-cancelled', {
                  callId,
                  reason: cancelReason,
                  cancelledBy: socket.userType
                });
              }
            }
            
          } catch (error) {
            console.error('Error handling disconnect for call:', callId, error);
          }
          
          activeCalls.delete(callId);
        }
      }
    });
  });
};

module.exports = socketHandler;