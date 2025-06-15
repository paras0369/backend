const mongoose = require("mongoose");

const callSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  therapistId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Therapist",
    required: true,
  },
  startTime: {
    type: Date,
    required: true,
  },
  endTime: {
    type: Date,
  },
  duration: {
    type: Number,
    default: 0,
  },
  userCost: {
    type: Number,
    default: 0,
  },
  therapistEarnings: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: [
      "initiated",
      "accepted",
      "rejected",
      "ongoing",
      "completed",
      "cancelled",
    ],
    default: "initiated",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Call", callSchema);
