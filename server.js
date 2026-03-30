require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pluginRoutes = require('./routes/plugin');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: '*', // Allow requests from any origin (e.g. Netlify)
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Routes
app.use('/api', pluginRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'PluginForge AI Backend is running 🔥' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ success: false, error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 PluginForge AI Backend running on http://localhost:${PORT}`);
  console.log(`🔑 SambaNova API Key: ${process.env.SAMBANOVA_API_KEY ? '✅ Configured' : '❌ Missing!'}`);
});
