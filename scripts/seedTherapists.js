const mongoose = require('mongoose');
const Therapist = require('../models/Therapist');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/therapist_call_app';

const therapists = [
  {
    name: 'Dr. Sarah Johnson',
    phoneNumber: '+1234567890',
    specialization: 'Cognitive Behavioral Therapy',
  },
  {
    name: 'Dr. Michael Chen',
    phoneNumber: '+1234567891',
    specialization: 'Family Therapy',
  },
  {
    name: 'Dr. Emily Rodriguez',
    phoneNumber: '+1234567892',
    specialization: 'Anxiety & Depression',
  },
  {
    name: 'Dr. David Thompson',
    phoneNumber: '+1234567893',
    specialization: 'Trauma Therapy',
  },
  {
    name: 'Dr. Lisa Park',
    phoneNumber: '+1234567894',
    specialization: 'Relationship Counseling',
  },
];

async function seedTherapists() {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('Connected to MongoDB');

    for (const therapistData of therapists) {
      const existingTherapist = await Therapist.findOne({ 
        phoneNumber: therapistData.phoneNumber 
      });

      if (!existingTherapist) {
        const therapist = new Therapist(therapistData);
        await therapist.save();
        console.log(`Created therapist: ${therapistData.name}`);
      } else {
        console.log(`Therapist already exists: ${therapistData.name}`);
      }
    }

    console.log('Therapist seeding completed');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding therapists:', error);
    process.exit(1);
  }
}

seedTherapists();