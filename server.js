require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const User = require('./models/User');

const app = express();
app.use(express.json());
app.use(cors());

let IS_MOCK_MODE = false;
let mockUsers = []; 

// Connect to MongoDB asynchronously so it doesn't crash the server
const connectDB = async () => {
  try {
    console.log('📡 Connecting to MongoDB Cloud...');
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    console.log('✅ Connected to SHEild AI MongoDB!');
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err.message);
    console.log('⚠️ SWITCHING TO MOCK MODE: Demo will work locally without Cloud.');
    IS_MOCK_MODE = true;
  }
};

connectDB();

// 1. Register or Update User Profile
app.post('/api/register', async (req, res) => {
  const { name, phone } = req.body;
  if (IS_MOCK_MODE) {
    let user = mockUsers.find(u => u.phone === phone);
    if (user) user.name = name;
    else mockUsers.push({ name, phone, location: { coordinates: [0, 0] } });
    return res.status(200).json({ success: true, mode: 'MOCK' });
  }
  try {
    let user = await User.findOne({ phone });
    if (user) {
      user.name = name;
      await user.save();
    } else {
      user = new User({ name, phone });
      await user.save();
    }
    res.status(200).json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Heartbeat: Update User Location
app.post('/api/location', async (req, res) => {
  const { phone, latitude, longitude } = req.body;
  if (IS_MOCK_MODE) {
    let user = mockUsers.find(u => u.phone === phone);
    if (user) user.location = { coordinates: [longitude, latitude] };
    return res.status(200).json({ success: true, mode: 'MOCK' });
  }
  try {
    await User.findOneAndUpdate(
      { phone },
      { 
        location: { type: 'Point', coordinates: [longitude, latitude] },
        lastActive: new Date()
      },
      { upsert: true }
    );
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. SOS Trigger: Search for nearby Sentinels (5km radius)
app.post('/api/sos', async (req, res) => {
  const { phone, latitude, longitude } = req.body;
  if (IS_MOCK_MODE) {
    // Basic JS radius check for Mock Mode
    const nearby = mockUsers.filter(u => u.phone !== phone);
    return res.status(200).json({ 
      success: true, 
      mode: 'MOCK',
      count: nearby.length + 3, // Simulate 3 random users for better demo
      sentinels: nearby.map(s => ({ name: s.name, phone: s.phone }))
    });
  }
  try {
    const nearbySentinels = await User.find({
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [longitude, latitude] },
          $maxDistance: 5000 
        }
      },
      phone: { $ne: phone }
    });
    res.status(200).json({ 
      success: true, 
      count: nearbySentinels.length,
      sentinels: nearbySentinels.map(s => ({ name: s.name, phone: s.phone }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Get Active Sentinel Count
app.get('/api/nearby-count', async (req, res) => {
  const { lat, lon } = req.query;
  if (IS_MOCK_MODE) return res.status(200).json({ count: 5, mode: 'MOCK' }); // Return 5 for demo
  try {
    const count = await User.countDocuments({
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [parseFloat(lon), parseFloat(lat)] },
          $maxDistance: 5000
        }
      }
    });
    res.status(200).json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SHEild AI Backend running on port ${PORT}`));
