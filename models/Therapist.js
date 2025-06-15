const mongoose = require('mongoose');

const therapistSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
  },
  specialization: {
    type: String,
    required: true,
  },
  totalEarnings: {
    type: Number,
    default: 0,
  },
  isAvailable: {
    type: Boolean,
    default: false,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

therapistSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Therapist', therapistSchema);