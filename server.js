'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const APP_SECRET = process.env.APP_SECRET || '';

if (!ADMIN_USER || !ADMIN_PASSWORD || APP_SECRET.length < 32) {
  console.error('ERROR: Set ADMIN_USER, ADMIN_PASSWORD and APP_SECRET (at least 32 characters) in Render Environment.');
  process.exit(1);
}

const DB_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const COIN_RATE = 100;
const USDT_RATE = 110;
const REFERRAL_PERCENT = 1;

function defaultDB() {
  return {
    users: [],
    deposits: [],
    withdrawals: [],
    ledger: [],
    tasks: []
  };
}

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(defaultDB(), null, 2));
    }

    const saved = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const db = { ...defaultDB(), ...saved };

    for (const key of ['users', 'deposits', 'withdrawals', 'ledger', 'tasks']) {
      if (!Array.isArray(db[key])) db[key] = [];
    }

    return db;
  } catch (error) {
    console.error('Could not read data.json:', error);
    throw new Error('Database could not be loaded. Original data has not been reset.');
  }
}

const db = loadDB();

function persist() {
  const tempFile = DB_FILE + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(db, null, 2));
  fs.renameSync(tempFile, DB_FILE);
}

// Remove the old daily task without touching other tasks or user data.
const originalTaskCount = db.tasks.length;
db.tasks = db.tasks.filter(task => task && task.id !== 'daily');
if (db.tasks.length !== originalTaskCount) persist();

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(data));
}

function read(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function makeHash(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(value), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function checkHash(value, stored) {
  if (!stored || typeof stored !== 'string') return false;

  // Current secure format: salt:hash
  if (stored.includes(':')) {
    const [salt, original] = stored.split(':');
    if (!salt || !original) return false;

    try {
      const test = crypto.scryptSync(String(value), salt, 64);
      const expected = Buffer.from(original, 'hex');
      return expected.length === test.length &&
        crypto.timingSafeEqual(test, expected);
    } catch {
      return false;
    }
  }

  // Legacy SHA-256 format, for existing accounts.
  if (/^[a-f0-9]{64}$/i.test(stored)) {
    const test = crypto.createHash('sha256').update(String(value)).digest('hex');
    const a = Buffer.from(test, 'hex');
    const b = Buffer.from(stored, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  return false;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function checkAdminPassword(value) {
  return safeEqual(value, ADMIN_PASSWORD);
}

function createToken(payload) {
  const data = Buffer.from(JSON.stringify({
    ...payload,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000
  })).toString('base64url');

  const signature = crypto
    .createHmac('sha256', APP_SECRET)
    .update(data)
    .digest('hex');

  return `${data}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [data, signature] = parts;
  const expected = crypto
    .createHmac('sha256', APP_SECRET)
    .update(data)
    .digest('hex');

  if (!safeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function getBearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function auth(req) {
  const payload = verifyToken(getBearer(req));
  if (!payload || payload.type !== 'user') return null;
  return db.users.find(user => user.id === payload.id) || null;
}

function adminAuth(req) {
  const payload = verifyToken(getBearer(req));
  return !!payload && payload.type === 'admin';
}

function userView(user) {
  const {
    passwordHash,
    pinHash,
    password,
    pin,
    ...safeUser
  } = user;

  return safeUser;
}

function record(user, title, amount, balance, status, note) {
  db.ledger.unshift({
    id: crypto.randomBytes(12).toString('hex'),
    userId: user.id,
    title,
    amount: Number(amount) || 0,
    balance: Number(balance ?? user.balance) || 0,
    status: status || 'completed',
    note: note || '',
    createdAt: new Date().toISOString()
  });
}

function makeId() {
  return crypto.randomBytes(16).toString('hex');
}

function findUser(id) {
  return db.users.find(user => user.id === String(id));
}

function validAmount(value, max = 1000000) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount <= max;
}

function getPathname(url) {
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return '/';
  }
}

async function handle(req, res) {
  const pathname = getPathname(req.url);
  const method = req.method || 'GET';

  if (method === 'GET' && pathname === '/api/health') {
    return send(res, 200, { ok: true, mode: 'DEMO' });
  }

  if (method === 'GET' && pathname === '/api/config') {
    return send(res, 200, {
      coinRate: COIN_RATE,
      usdtRate: USDT_RATE,
      referralPercent: REFERRAL_PERCENT,
      mode: 'DEMO'
    });
  }

  // USER REGISTRATION
  if (method === 'POST' && pathname === '/api/register') {
    const b = await read(req);
    const name = String(b.name || '').trim();
    const phone = String(b.phone || '').trim();
    const password = String(b.password || '');
    const pin = String(b.pin || '');

    if (name.length < 2 || name.length > 60) {
      return send(res, 400, { error: 'Enter a valid name.' });
    }

    if (!/^[0-9]{10,15}$/.test(phone)) {
      return send(res, 400, { error: 'Enter a valid phone number.' });
    }

    if (password.length < 8 || password.length > 100) {
      return send(res, 400, { error: 'Password must be at least 8 characters.' });
    }

    if (!/^[0-9]{4,6}$/.test(pin)) {
      return send(res, 400, { error: 'Security PIN must contain 4 to 6 digits.' });
    }

    if (db.users.some(user => String(user.phone) === phone)) {
      return send(res, 409, { error: 'This phone number is already registered.' });
    }

    let referredBy = null;
    const referralCode = String(b.referral || '').trim();
    if (referralCode) {
      const referrer = db.users.find(user =>
        String(user.referralCode || '').toLowerCase() === referralCode.toLowerCase()
      );
      if (referrer) referredBy = referrer.id;
    }

    const user = {
      id: makeId(),
      name,
      phone,
      passwordHash: makeHash(password),
      pinHash: makeHash(pin),
      balance: 0,
      earned: 0,
      referralCode: crypto.randomBytes(4).toString('hex').toUpperCase(),
      referredBy,
      createdAt: new Date().toISOString()
    };

    db.users.push(user);
    record(user, 'Account created', 0, 0, 'completed', 'Welcome to HUNTER PAY');
    persist();

    return send(res, 201, {
      token: createToken({ type: 'user', id: user.id }),
      user: userView(user)
    });
  }

  // USER LOGIN
  if (method === 'POST' && pathname === '/api/login') {
    const b = await read(req);
    const phone = String(b.phone || '').trim();
    const password = String(b.password || '');

    const user = db.users.find(item => String(item.phone) === phone);
    if (!user) return send(res, 401, { error: 'Invalid phone number or password.' });

    if (!user.passwordHash) {
      return send(res, 403, {
        error: 'Password setup required. Contact Admin for verified account recovery.'
      });
    }

    if (!checkHash(password, user.passwordHash)) {
      return send(res, 401, { error: 'Invalid phone number or password.' });
    }

    return send(res, 200, {
      token: createToken({ type: 'user', id: user.id }),
      user: userView(user)
    });
  }

  // ADMIN LOGIN
  if (method === 'POST' && pathname === '/api/admin/login') {
    const b = await read(req);
    if (!safeEqual(b.username || '', ADMIN_USER) ||
        !checkAdminPassword(b.password || '')) {
      return send(res, 401, { error: 'Invalid admin username or password.' });
    }

    return send(res, 200, {
      token: createToken({ type: 'admin', username: ADMIN_USER })
    });
  }

  // ADMIN ROUTES
  if (pathname.startsWith('/api/admin/')) {
    if (!adminAuth(req)) {
      return send(res, 401, { error: 'Admin authentication required.' });
    }

    if (method === 'GET' && pathname === '/api/admin/overview') {
      return send(res, 200, {
        users: db.users.map(userView),
        deposits: db.deposits,
        withdrawals: db.withdrawals,
        ledger: db.ledger,
        tasks: db.tasks,
        stats: {
          users: db.users.length,
          deposits: db.deposits.length,
          withdrawals: db.withdrawals.length,
          balance: db.users.reduce((sum, user) => sum + (Number(user.balance) || 0), 0)
        }
      });
    }

    if (method === 'POST' && pathname === '/api/admin/set-legacy-credentials') {
      const b = await read(req);
      const user = findUser(b.userId);

      if (!user) return send(res, 404, { error: 'User not found.' });

      if (b.identityVerified !== true) {
        return send(res, 400, { error: 'Admin must confirm independent identity verification.' });
      }

      const password = String(b.password || '');
      const pin = String(b.pin || '');

      if (password.length < 8 || password.length > 100) {
        return send(res, 400, { error: 'Password must be at least 8 characters.' });
      }

      if (!/^[0-9]{4,6}$/.test(pin)) {
        return send(res, 400, { error: 'PIN must contain 4 to 6 digits.' });
      }

      user.passwordHash = makeHash(password);
      user.pinHash = makeHash(pin);
      user.credentialsUpdatedAt = new Date().toISOString();

      record(user, 'Legacy account credentials updated', 0, user.balance, 'completed',
        'Admin-assisted recovery after independent identity verification');
      persist();

      return send(res, 200, { message: 'User credentials updated successfully.' });
    }

    if (method === 'POST' && pathname === '/api/admin/deposit') {
      const b = await read(req);
      const deposit = db.deposits.find(item => item.id === b.id);
      if (!deposit) return send(res, 404, { error: 'Deposit not found.' });
      if (deposit.status !== 'pending') {
        return send(res, 400, { error: 'This deposit has already been reviewed.' });
      }

      const action = String(b.action || '').toLowerCase();
      const user = findUser(deposit.userId);

      if (action === 'approve') {
        if (!user) return send(res, 404, { error: 'Deposit user not found.' });

        const usdt = Number(deposit.usdt ?? deposit.amount);
        const coins = Number(deposit.coins ?? (usdt * USDT_RATE * COIN_RATE));

        if (!Number.isFinite(coins) || coins <= 0) {
          return send(res, 400, { error: 'Invalid deposit amount.' });
        }

        deposit.status = 'approved_demo';
        deposit.reviewedAt = new Date().toISOString();
        user.balance = (Number(user.balance) || 0) + coins;

        record(user, 'Demo deposit approved', coins, user.balance, 'completed',
          'Admin approved demo deposit');

        // Direct referral commission: 1% on the first approved deposit only.
        if (!deposit.referralCommission && user.referredBy) {
          const referrer = findUser(user.referredBy);
          const hasEarlierApprovedDeposit = db.deposits.some(item =>
            item.userId === user.id &&
            item.id !== deposit.id &&
            (item.status === 'approved_demo' || item.status === 'approved')
          );

          if (referrer && !hasEarlierApprovedDeposit) {
            const commission = Math.floor(coins * REFERRAL_PERCENT / 100);
            if (commission > 0) {
              referrer.balance = (Number(referrer.balance) || 0) + commission;
              deposit.referralCommission = commission;
              record(referrer, 'Direct referral commission', commission,
                referrer.balance, 'completed', '1% of first approved referral deposit');
            }
          }
        }
      } else if (action === 'reject') {
        deposit.status = 'rejected';
        deposit.reviewedAt = new Date().toISOString();

        if (user) {
          record(user, 'Demo deposit rejected', 0, user.balance, 'rejected',
            'Admin rejected demo deposit request');
        }
      } else {
        return send(res, 400, { error: 'Invalid action.' });
      }

      persist();
      return send(res, 200, { message: 'Deposit updated successfully.' });
    }

    if (method === 'POST' && pathname === '/api/admin/withdrawal') {
      const b = await read(req);
      const withdrawal = db.withdrawals.find(item => item.id === b.id);
      if (!withdrawal) return send(res, 404, { error: 'Withdrawal not found.' });
      if (withdrawal.status !== 'pending') {
        return send(res, 400, { error: 'This withdrawal has already been reviewed.' });
      }

      const user = findUser(withdrawal.userId);
      if (!user) return send(res, 404, { error: 'User not found.' });

      const action = String(b.action || '').toLowerCase();

      if (action === 'approve') {
        withdrawal.status = 'approved_demo';
        withdrawal.reviewedAt = new Date().toISOString();

        record(user, 'Demo withdrawal approved', -Number(withdrawal.amount || 0),
          user.balance, 'approved_demo',
          'Admin approved demo request; no real money was transferred');
      } else if (action === 'reject') {
        withdrawal.status = 'rejected';
        withdrawal.reviewedAt = new Date().toISOString();

        const refund = Number(withdrawal.amount) || 0;
        user.balance = (Number(user.balance) || 0) + refund;

        record(user, 'Demo withdrawal refunded', refund, user.balance,
          'completed', 'Withdrawal request rejected; demo balance returned');
      } else {
        return send(res, 400, { error: 'Invalid action.' });
      }

      persist();
      return send(res, 200, { message: 'Withdrawal updated successfully.' });
    }

    if (method === 'POST' && pathname === '/api/admin/credit') {
      const b = await read(req);
      const user = findUser(b.userId);
      if (!user) return send(res, 404, { error: 'User not found.' });

      if (!validAmount(b.amount)) {
        return send(res, 400, { error: 'Enter a valid credit amount.' });
      }

      const amount = Number(b.amount);
      user.balance = (Number(user.balance) || 0) + amount;

      record(user, 'Admin demo credit', amount, user.balance, 'completed',
        String(b.note || 'Credit added by Admin').slice(0, 200));

      persist();
      return send(res, 200, { message: 'Demo credit added successfully.' });
    }

    if (method === 'POST' && pathname === '/api/admin/task') {
      const b = await read(req);
      const id = String(b.id || makeId());

      if (id === 'daily') {
        return send(res, 400, { error: 'Daily check-in task is disabled.' });
      }

      const title = String(b.title || '').trim();
      const description = String(b.description || '').trim();
      const coins = Number(b.coins);

      if (title.length < 2 || title.length > 80) {
        return send(res, 400, { error: 'Task title must be 2 to 80 characters.' });
      }

      if (description.length > 300) {
        return send(res, 400, { error: 'Task description is too long.' });
      }

      if (!Number.isInteger(coins) || coins < 1 || coins > 100000) {
        return send(res, 400, { error: 'Enter a valid task reward.' });
      }

      let task = db.tasks.find(item => item.id === id);
      if (!task) {
        task = { id };
        db.tasks.push(task);
      }

      task.title = title;
      task.description = description;
      task.coins = coins;
      task.active = b.active !== false;
      task.updatedAt = new Date().toISOString();

      persist();
      return send(res, 200, { message: 'Task saved successfully.', task });
    }

    return send(res, 404, { error: 'Admin API route not found.' });
  }

  // USER AUTHENTICATED ROUTES
  if (pathname.startsWith('/api/')) {
    const user = auth(req);
    if (!user) return send(res, 401, { error: 'Please log in again.' });

    if (method === 'GET' && pathname === '/api/me') {
      return send(res, 200, {
        user: userView(user),
        deposits: db.deposits.filter(item => item.userId === user.id),
        withdrawals: db.withdrawals.filter(item => item.userId === user.id),
        ledger: db.ledger.filter(item => item.userId === user.id).slice(0, 100),
        tasks: db.tasks.filter(task => task.active !== false && task.id !== 'daily')
      });
    }

    if (method === 'POST' && pathname === '/api/security/pin') {
      const b = await read(req);
      const oldPin = String(b.oldPin || '');
      const newPin = String(b.newPin || '');

      if (!user.pinHash || !checkHash(oldPin, user.pinHash)) {
        return send(res, 400, { error: 'Current Security PIN is incorrect.' });
      }

      if (!/^[0-9]{4,6}$/.test(newPin)) {
        return send(res, 400, { error: 'New PIN must contain 4 to 6 digits.' });
      }

      user.pinHash = makeHash(newPin);
      persist();
      return send(res, 200, { message: 'Security PIN updated.' });
    }

    if (method === 'POST' && pathname === '/api/deposit') {
      const b = await read(req);
      const usdt = Number(b.usdt ?? b.amount);

      if (!validAmount(usdt, 100000)) {
        return send(res, 400, { error: 'Enter a valid demo deposit amount.' });
      }

      const deposit = {
        id: makeId(),
        userId: user.id,
        usdt,
        amount: usdt,
        coins: Math.floor(usdt * USDT_RATE * COIN_RATE),
        reference: String(b.reference || '').slice(0, 100),
        status: 'pending',
        createdAt: new Date().toISOString()
      };

      db.deposits.unshift(deposit);
      record(user, 'Demo deposit requested', 0, user.balance, 'pending',
        `${usdt} demo USDT deposit request`);
      persist();

      return send(res, 201, {
        message: 'Demo deposit request submitted for Admin review.',
        deposit
      });
    }

    if (method === 'POST' && pathname === '/api/claim') {
      const b = await read(req);
      const task = db.tasks.find(item =>
        item.id === String(b.taskId || b.id || '') &&
        item.active !== false &&
        item.id !== 'daily'
      );

      if (!task) return send(res, 404, { error: 'Task not found or inactive.' });

      const claimed = Array.isArray(user.claimedTasks) ? user.claimedTasks : [];
      if (claimed.includes(task.id)) {
        return send(res, 400, { error: 'You have already claimed this task.' });
      }

      const reward = Number(task.coins);
      if (!Number.isInteger(reward) || reward <= 0) {
        return send(res, 400, { error: 'Invalid task reward.' });
      }

      user.claimedTasks = [...claimed, task.id];
      user.balance = (Number(user.balance) || 0) + reward;
      user.earned = (Number(user.earned) || 0) + reward;

      record(user, 'Task reward', reward, user.balance, 'completed', task.title);
      persist();

      return send(res, 200, { message: 'Task reward claimed.', reward });
    }

    if (method === 'POST' && pathname === '/api/withdraw') {
      const b = await read(req);
      const amount = Number(b.amount);
      const pin = String(b.pin || '');

      if (!validAmount(amount)) {
        return send(res, 400, { error: 'Enter a valid withdrawal amount.' });
      }

      if (!user.pinHash || !checkHash(pin, user.pinHash)) {
        return send(res, 400, { error: 'Incorrect Security PIN.' });
      }

      if (amount > (Number(user.balance) || 0)) {
        return send(res, 400, { error: 'Insufficient demo balance.' });
      }

      const upi = String(b.upi || '').trim();
      if (upi.length < 3 || upi.length > 100) {
        return send(res, 400, { error: 'Enter a valid UPI ID.' });
      }

      user.balance = (Number(user.balance) || 0) - amount;

      const withdrawal = {
        id: makeId(),
        userId: user.id,
        amount,
        upi,
        status: 'pending',
        createdAt: new Date().toISOString()
      };

      db.withdrawals.unshift(withdrawal);
      record(user, 'Demo withdrawal requested', -amount, user.balance,
        'pending', 'Demo withdrawal request; no real payout is made');
      persist();

      return send(res, 201, {
        message: 'Demo withdrawal request submitted for Admin review.',
        withdrawal
      });
    }

    if (method === 'GET' && pathname === '/api/referral') {
      const referrals = db.users.filter(item => item.referredBy === user.id);
      return send(res, 200, {
        referralCode: user.referralCode,
        referrals: referrals.map(item => ({
          name: item.name,
          createdAt: item.createdAt
        })),
        commissionPercent: REFERRAL_PERCENT
      });
    }

    return send(res, 404, { error: 'API route not found.' });
  }

  // STATIC WEBSITE FILES
  if (method !== 'GET' && method !== 'HEAD') {
    return send(res, 405, { error: 'Method not allowed.' });
  }

  let requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');

  if (requested === 'admin') requested = 'admin.html';

  const filePath = path.resolve(PUBLIC_DIR, requested);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return send(res, 403, { error: 'Forbidden.' });
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Page not found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.webp': 'image/webp'
    };

    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });

    if (method === 'HEAD') return res.end();
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(error => {
    console.error('Request error:', error);
    if (!res.headersSent) {
      send(res, 500, { error: 'Something went wrong. Please try again.' });
    } else {
      res.destroy();
    }
  });
});

server.listen(PORT, () => {
  console.log(`HUNTER PAY server running on port ${PORT} in DEMO mode.`);
});
