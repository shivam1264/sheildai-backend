const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  lastActive: { type: Date, default: Date.now },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      required: true,
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true,
      default: [0, 0]
    }
  },
  isSosActive: { type: Boolean, default: false }
});

// IMPORTANT: Create 2dsphere index for geospatial queries
UserSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('User', UserSchema);
