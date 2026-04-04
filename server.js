require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const User = require('./models/User');

const app = express();
app.use(express.json());
app.use(cors());

// Health check endpoint (used by self-ping to prevent Render cold start)
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', time: new Date() }));


let IS_MOCK_MODE = false;
let mockUsers = []; 
let activeAlerts = []; // Memory store for active SOS alerts (expires in 10 mins)

// Clean up expired alerts every 1 minute
setInterval(() => {
  const now = Date.now();
  activeAlerts = activeAlerts.filter(a => now - a.timestamp < 10 * 60 * 1000);
}, 60000);

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
  if (!phone || String(phone).trim() === "" || String(phone).toLowerCase() === "undefined") {
    return res.status(200).json({ success: true, alerts: [], message: "Waiting for user profile phone registration." });
  }
  if (IS_MOCK_MODE) {
    let user = mockUsers.find(u => u.phone === phone);
    if (user) user.location = { coordinates: [longitude, latitude] };
    return res.status(200).json({ success: true, mode: 'MOCK' });
  }
  try {
    const now = Date.now();
    await User.findOneAndUpdate(
      { phone },
      { 
        location: { type: 'Point', coordinates: [longitude, latitude] },
        lastActive: new Date(now)
      },
      { upsert: true }
    );

    // CHECK FOR NEARBY ACTIVE ALERTS
    // Helper to calculate distance in KM
    const getDistance = (lat1, lon1, lat2, lon2) => {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const nearbyAlerts = activeAlerts.filter(a => {
        if (String(a.phone).trim() === String(phone).trim()) return false; // Don't notify yourself
        const dist = getDistance(latitude, longitude, a.lat, a.lon);
        return dist <= 5.0; // 5km radius
    });

    res.status(200).json({ success: true, alerts: nearbyAlerts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. SOS Trigger: Search for nearby Sentinels (5km radius)
app.post('/api/sos', async (req, res) => {
  const { phone, latitude, longitude } = req.body;
  if (!phone || String(phone).trim() === "" || String(phone).toLowerCase() === "undefined") {
    return res.status(400).json({ error: "Valid phone number required for SOS broadcast." });
  }
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
    const now = Date.now();
    // Register as Active Alert for Community Polling
    activeAlerts = activeAlerts.filter(a => String(a.phone).trim() !== String(phone).trim()); // Replace old alert from same phone
    activeAlerts.push({ 
        phone, 
        lat: latitude, 
        lon: longitude, 
        timestamp: now,
        id: `alert-${now}-${phone}` 
    });

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
app.listen(PORT, () => {
  console.log(`SHEild AI Backend running on port ${PORT}`);

  // ✅ SELF-PING: Keeps Render free server awake (pings every 9 minutes)
  const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  setInterval(async () => {
    try {
      const https = require('https');
      const http = require('http');
      const lib = SELF_URL.startsWith('https') ? https : http;
      lib.get(`${SELF_URL}/health`, (res) => {
        console.log(`💓 Self-ping OK (${res.statusCode})`);
      }).on('error', (e) => {
        console.log('Self-ping error:', e.message);
      });
    } catch (e) {}
  }, 9 * 60 * 1000); // Every 9 minutes
});

