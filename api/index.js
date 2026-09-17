// Vercel deploys Node code as serverless functions, not a persistent
// server — so this file exists purely to reuse the real Express routes
// (in supabase-backend/server/routes) inside that model, without
// duplicating any route logic. Local development is unaffected: running
// `npm start` in supabase-backend/ still starts the regular Express
// server the normal way.
require('dotenv').config();
const express = require('express');

const authRoutes = require('../supabase-backend/server/routes/auth');
const shopRoutes = require('../supabase-backend/server/routes/shops');
const productRoutes = require('../supabase-backend/server/routes/products');
const orderRoutes = require('../supabase-backend/server/routes/orders');
const messageRoutes = require('../supabase-backend/server/routes/messages');

const app = express();
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/shops', shopRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/messages', messageRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

// An Express app is itself a valid (req, res) request handler, which is
// exactly what Vercel's Node runtime expects — no extra wrapping needed.
module.exports = app;