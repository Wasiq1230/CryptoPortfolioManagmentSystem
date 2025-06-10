const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const app = express();
const livereload = require('livereload');

const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'crypto_secret',
  resave: false,
  saveUninitialized: false,
}));
app.use(express.static(path.join(__dirname, 'public')));

const connectLivereload = require('connect-livereload');

// Start livereload server
const liveReloadServer = livereload.createServer();
liveReloadServer.watch(path.join(__dirname, 'public'));

// Inject livereload script into HTML
app.use(connectLivereload());

// Reload the browser when changes are detected
liveReloadServer.server.once("connection", () => {
  setTimeout(() => {
    liveReloadServer.refresh("/");
  }, 100);
});

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'CryptoManagementSystem',
  password: '123456',
  port: 5432,
});

// Proxy to fetch top 30 cryptos from CoinGecko
app.get('/api/cryptos', async (req, res) => {
  try {
    const cgRes = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
      params: {
        vs_currency: 'usd',
        order: 'market_cap_desc',
        per_page: 30,
        page: 1,
        sparkline: false
      }
    });
    res.json(cgRes.data);
  } catch (err) {
    console.error('CoinGecko error:', err.message);
    res.status(500).json({ error: 'Failed to fetch cryptos' });
  }
});

// Auth routes
app.post('/register', async (req, res) => {
  const { username, password, balance } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO Users (username, password, balance) VALUES ($1,$2,$3)', [username, hash, balance]);
    res.json({ success: true, message: 'Registered!' });
  } catch {
    res.status(400).json({ success: false, message: 'Username taken?' });
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const r = await pool.query('SELECT * FROM Users WHERE username=$1', [username]);
    const user = r.rows[0];
    if (user && await bcrypt.compare(password, user.password)) {
      req.session.userId = user.id;
      return res.json({ success: true });
    }
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  } catch {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// Protected routes
app.get('/portfolio', requireLogin, async (req, res) => {
  const r = await pool.query('SELECT symbol, name, amount FROM Portfolio WHERE userId=$1', [req.session.userId]);
  res.json(r.rows);
});

app.get('/balance', requireLogin, async (req, res) => {
  const r = await pool.query('SELECT balance FROM Users WHERE id=$1', [req.session.userId]);
  res.json(r.rows[0]);
});

app.post('/add-funds', requireLogin, async (req, res) => {
  await pool.query('UPDATE Users SET balance = balance + $1 WHERE id = $2', [req.body.amount, req.session.userId]);
  res.json({ success: true });
});

app.post('/buy', requireLogin, async (req, res) => {
  const { symbol, name, amount, price } = req.body;
  const total = parseFloat(price) * parseFloat(amount);
  const balR = await pool.query('SELECT balance FROM Users WHERE id=$1', [req.session.userId]);
  if (parseFloat(balR.rows[0].balance) < total) return res.status(400).json({ error: 'Insufficient balance' });

  await pool.query('UPDATE Users SET balance = balance - $1 WHERE id = $2', [total, req.session.userId]);
  const pR = await pool.query('SELECT * FROM Portfolio WHERE userId=$1 AND symbol=$2', [req.session.userId, symbol]);
  if (pR.rows.length) {
    await pool.query('UPDATE Portfolio SET amount = amount + $1 WHERE userId=$2 AND symbol=$3', [amount, req.session.userId, symbol]);
  } else {
    await pool.query('INSERT INTO Portfolio (userId,symbol,name,amount) VALUES ($1,$2,$3,$4)', [req.session.userId, symbol, name, amount]);
  }

  await pool.query('INSERT INTO Transactions (userId,symbol,name,amount,price,total,type) VALUES($1,$2,$3,$4,$5,$6,\'buy\')', [req.session.userId, symbol, name, amount, price, total]);
  res.json({ success: true });
});

app.post('/sell', requireLogin, async (req, res) => {
  const { symbol, name, amount, price } = req.body;
  const pR = await pool.query('SELECT * FROM Portfolio WHERE userId=$1 AND symbol=$2', [req.session.userId, symbol]);
  if (!pR.rows.length || parseFloat(pR.rows[0].amount) < amount) return res.status(400).json({ error: 'Not enough holdings' });
  const total = price * amount;
  await pool.query('UPDATE Users SET balance = balance + $1 WHERE id = $2', [total, req.session.userId]);
  await pool.query('UPDATE Portfolio SET amount = amount - $1 WHERE userId = $2 AND symbol = $3', [amount, req.session.userId, symbol]);
  await pool.query('INSERT INTO Transactions (userId,symbol,name,amount,price,total,type) VALUES($1,$2,$3,$4,$5,$6,\'sell\')', [req.session.userId, symbol, name, amount, price, total]);
  res.json({ success: true });
});

app.post('/watchlist', requireLogin, async (req, res) => {
  await pool.query('INSERT INTO Watchlist (userId,symbol,name) VALUES($1,$2,$3)', [req.session.userId, req.body.symbol, req.body.name]);
  res.json({ success: true });
});

app.delete('/watchlist/:symbol', requireLogin, async (req, res) => {
  const symbol = req.params.symbol;
  const userId = req.session.userId;
  
  try {
    await pool.query(
      'DELETE FROM Watchlist WHERE userId = $1 AND symbol = $2',
      [userId, symbol]
    );
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete from watchlist' });
  }
});

app.get('/watchlist', requireLogin, async (req, res) => {
  const r = await pool.query('SELECT symbol, name FROM Watchlist WHERE userId=$1', [req.session.userId]);
  res.json(r.rows);
});

app.get('/profile', requireLogin, async (req, res) => {
  const r = await pool.query('SELECT username, balance FROM Users WHERE id=$1', [req.session.userId]);
  res.json(r.rows[0]);
});

app.get('/transactions', requireLogin, async (req, res) => {
  const r = await pool.query('SELECT symbol, name, amount, price, total, type, timestamp FROM Transactions WHERE userId=$1 ORDER BY timestamp DESC', [req.session.userId]);
  res.json(r.rows);
});

// Default serve
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
