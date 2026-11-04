
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DB = path.join(ROOT, 'data.json');
const PORT = Number(process.env.PORT || 3000);

const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SECRET = process.env.APP_SECRET;

if (!ADMIN_USER || !ADMIN_PASSWORD || !SECRET || SECRET.length < 32) {
  throw new Error('Set ADMIN_USER, ADMIN_PASSWORD and APP_SECRET (at least 32 characters) in Render Environment.');
}

const COIN_RATE = 100;
const USDT_RATE = 110;
const REFERRAL_PERCENT = 1;

const defaultTasks = [
  {
    id: 'offer',
    title: 'Explore an offer',
    description: 'Try a sample demo offer task',
    coins: 25,
    active: true
  },
  {
    id: 'profile',
    title: 'Complete profile',
    description: 'Complete your demo profile',
    coins: 15,
    active: true
  }
];

let db;

if (fs.existsSync(DB)) {
  db = JSON.parse(fs.readFileSync(DB, 'utf8'));
} else {
  db = {
    users: [],
    withdrawals: [],
    deposits: [],
    ledger: [],
    tasks: defaultTasks
  };
}

db.users ||= [];
db.withdrawals ||= [];
db.deposits ||= [];
db.ledger ||= [];
db.tasks ||= defaultTasks;

function persist() {
  const tmp = DB + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB);
}

function id() {
  return crypto.randomBytes(16).toString('hex');
}

function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function validPassword(s) {
  return typeof s === 'string' && s.length >= 8 && s.length <= 128;
}

function validPin(s) {
  return /^\d{6}$/.test(String(s || ''));
}

// Secure password/PIN hashing using scrypt and a unique salt.
function makeHash(value) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(value, salt, 64);
  return salt.toString('hex') + ':' + derived.toString('hex');
}

function checkHash(value, stored) {
  try {
    const [saltHex, hashHex] = String(stored || '').split(':');
    if (!saltHex || !hashHex) return false;

    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(value, salt, 64);

    return expected.length === actual.length &&
      crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function token(payload) {
  const body = Buffer.from(JSON.stringify({
    ...payload,
    exp: Date.now() + 7 * 864e5
  })).toString('base64url');

  const signature = crypto.createHmac('sha256', SECRET)
    .update(body).digest('base64url');

  return body + '.' + signature;
}

function verifyToken(value) {
  try {
    const [body, signature] = String(value || '').split('.');
    if (!body || !signature) return null;

    const expected = crypto.createHmac('sha256', SECRET)
      .update(body).digest('base64url');

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);

    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString()
    );

    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function send(res, status, data, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers
  });

  res.end(JSON.stringify(data));
}

function read(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let finished = false;

    req.on('data', chunk => {
      if (finished) return;

      body += chunk;

      if (body.length > 1e6) {
        finished = true;
        reject(Error('Request too large'));
      }
    });

    req.on('end', () => {
      if (finished) return;

      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Error('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
}

function auth(req, role) {
  const header = req.headers.authorization || '';
  const session = verifyToken(
    header.replace(/^Bearer\s+/i, '')
  );

  return session && (!role || session.role === role)
    ? session
    : null;
}

function userView(u) {
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    referralCode: u.referralCode,
    balance: Number(u.balance || 0),
    coins: Number(u.coins || 0),
    earned: Number(u.earned || 0),
    claimed: u.claimed || [],
    createdAt: u.createdAt,
    passwordSetupRequired: !u.passwordHash,
    securityPinSetupRequired: !u.pinHash
  };
}

function record(u, type, coins, amount, status = 'success', note = '') {
  db.ledger.unshift({
    id: id(),
    userId: u.id,
    type,
    coins,
    amount,
    status,
    note,
    createdAt: new Date().toISOString()
  });
}

function createUserToken(u) {
  return token({ sub: u.id, role: 'user' });
}

function validPhone(value) {
  return /^\d{10}$/.test(String(value || ''));
}

function findUserBySession(session) {
  return db.users.find(u => u.id === session.sub);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (req.method === 'GET' && p === '/health') {
      return send(res, 200, {
        ok: true,
        app: 'HUNTER PAY Demo'
      });
    }

    if (req.method === 'GET' && p === '/api/config') {
      return send(res, 200, {
        mode: 'DEMO',
        coinRate: COIN_RATE,
        usdtRate: USDT_RATE,
        referralPercent: REFERRAL_PERCENT,
        realPayments: false
      });
    }

    // USER REGISTRATION
    if (req.method === 'POST' && p === '/api/register') {
      const b = await read(req);

      const name = String(b.name || '').trim();
      const phone = String(b.phone || '').replace(/\D/g, '');
      const password = String(b.password || '');
      const pin = String(b.pin || '');

      if (name.length < 2 || name.length > 80 || !validPhone(phone)) {
        return send(res, 400, {
          error: 'Enter your name and a valid 10-digit mobile number'
        });
      }

      if (!validPassword(password)) {
        return send(res, 400, {
          error: 'Password must contain at least 8 characters'
        });
      }

      if (!validPin(pin)) {
        return send(res, 400, {
          error: 'Security PIN must contain exactly 6 digits'
        });
      }

      if (db.users.some(u => u.phone === phone)) {
        return send(res, 409, {
          error: 'This mobile number is already registered. Contact Admin for account recovery.'
        });
      }

      const u = {
        id: id(),
        name,
        phone,
        passwordHash: makeHash(password),
        pinHash: makeHash(pin),
        referralCode: 'HP' + phone.slice(-4) +
          crypto.randomBytes(3).toString('hex').toUpperCase(),
        balance: 0,
        coins: 0,
        earned: 0,
        claimed: [],
        createdAt: new Date().toISOString()
      };

      const ref = String(b.referralCode || '').trim().toUpperCase();
      const inviter = db.users.find(x => x.referralCode === ref);

      if (ref && inviter && inviter.id !== u.id) {
        u.referredBy = inviter.id;
      }

      db.users.push(u);
      persist();

      return send(res, 201, {
        token: createUserToken(u),
        user: userView(u)
      });
    }

    // USER LOGIN
    if (req.method === 'POST' && p === '/api/login') {
      const b = await read(req);
      const phone = String(b.phone || '').replace(/\D/g, '');
      const password = String(b.password || '');

      if (!validPhone(phone) || !password) {
        return send(res, 400, {
          error: 'Enter your mobile number and password'
        });
      }

      const u = db.users.find(x => x.phone === phone);

      if (!u) {
        return send(res, 404, {
          error: 'Account not found. Please register first.'
        });
      }

      if (!u.passwordHash) {
        return send(res, 403, {
          error: 'Password setup required. Contact Admin for verified account recovery.'
        });
      }

      if (!checkHash(password, u.passwordHash)) {
        return send(res, 401, {
          error: 'Incorrect mobile number or password'
        });
      }

      return send(res, 200, {
        token: createUserToken(u),
        user: userView(u)
      });
    }

    // ADMIN LOGIN
    if (req.method === 'POST' && p === '/api/admin/login') {
      const b = await read(req);

      const username = String(b.username || '');
      const password = String(b.password || '');

      const a = Buffer.from(username);
      const expectedUser = Buffer.from(ADMIN_USER);

      const userOK = a.length === expectedUser.length &&
        crypto.timingSafeEqual(a, expectedUser);

      const passwordOK = checkAdminPassword(password);

      if (!userOK || !passwordOK) {
        return send(res, 401, {
          error: 'Invalid admin credentials'
        });
      }

      return send(res, 200, {
        token: token({ sub: 'admin', role: 'admin' }),
        role: 'admin'
      });
    }

    // ALL OTHER API ROUTES REQUIRE AUTHENTICATION
    if (p.startsWith('/api/')) {
      const isAdmin = p.startsWith('/api/admin/');
      const session = auth(req, isAdmin ? 'admin' : 'user');

      if (!session) {
        return send(res, 401, {
          error: 'Please sign in again'
        });
      }

      if (!isAdmin) {
        const u = findUserBySession(session);

        if (!u) {
          return send(res, 401, { error: 'User not found' });
        }

        u.claimed ||= [];

        // USER PROFILE
        if (req.method === 'GET' && p === '/api/me') {
          return send(res, 200, {
            user: userView(u),
            tasks: db.tasks.filter(t => t.active),
            transactions: db.ledger.filter(x => x.userId === u.id).slice(0, 100),
            withdrawals: db.withdrawals.filter(x => x.userId === u.id),
            deposits: db.deposits.filter(x => x.userId === u.id),
            settings: {
              usdtRate: USDT_RATE,
              referralPercent: REFERRAL_PERCENT
            }
          });
        }

        // SET OR CHANGE APP SECURITY PIN
        if (req.method === 'POST' && p === '/api/security/pin') {
          const b = await read(req);
          const oldPin = String(b.oldPin || '');
          const newPin = String(b.newPin || '');

          if (!validPin(newPin)) {
            return send(res, 400, {
              error: 'New Security PIN must contain exactly 6 digits'
            });
          }

          if (u.pinHash && !checkHash(oldPin, u.pinHash)) {
            return send(res, 401, {
              error: 'Current Security PIN is incorrect'
            });
          }

          u.pinHash = makeHash(newPin);
          persist();

          return send(res, 200, {
            message: 'Security PIN updated successfully'
          });
        }

        // DEMO DEPOSIT REQUEST
        if (req.method === 'POST' && p === '/api/deposit') {
          const b = await read(req);
          const amount = Number(b.amount);
          const reference = String(b.reference || '').trim();

          if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
            return send(res, 400, {
              error: 'Enter a valid demo USDT amount (minimum 1)'
            });
          }

          if (reference.length < 4 || reference.length > 120) {
            return send(res, 400, {
              error: 'Enter a demo reference between 4 and 120 characters'
            });
          }

          if (db.deposits.some(d =>
            String(d.reference).toLowerCase() === reference.toLowerCase()
          )) {
            return send(res, 409, {
              error: 'This reference has already been submitted'
            });
          }

          const deposit = {
            id: id(),
            userId: u.id,
            name: u.name,
            phone: u.phone,
            usdt: amount,
            rate: USDT_RATE,
            inrAmount: roundMoney(amount * USDT_RATE),
            reference,
            status: 'pending',
            createdAt: new Date().toISOString()
          };

          db.deposits.unshift(deposit);

          record(
            u,
            'Demo USDT deposit request',
            0,
            0,
            'pending',
            amount + ' demo USDT; reference: ' + reference
          );

          persist();
          return send(res, 201, { deposit });
        }

        // CLAIM TASK
        if (req.method === 'POST' && p === '/api/claim') {
          const b = await read(req);
          const t = db.tasks.find(x => x.id === b.taskId && x.active);

          if (!t) {
            return send(res, 404, { error: 'Task not available' });
          }

          if (u.claimed.includes(t.id)) {
            return send(res, 409, { error: 'Reward already claimed' });
          }

          u.claimed.push(t.id);
          u.coins = Number(u.coins || 0) + Number(t.coins);

          const amount = Number(t.coins) / COIN_RATE;
          u.balance = roundMoney(Number(u.balance || 0) + amount);
          u.earned = roundMoney(Number(u.earned || 0) + amount);

          record(u, t.title, t.coins, amount);
          persist();

          return send(res, 200, { user: userView(u) });
        }

        // DEMO WITHDRAWAL REQUEST
        if (req.method === 'POST' && p === '/api/withdraw') {
          const b = await read(req);
          const amount = Number(b.amount);
          const upi = String(b.upi || '').trim();
          const pin = String(b.pin || '');

          if (!u.pinHash) {
            return send(res, 403, {
              error: 'Please set your 6-digit Security PIN first'
            });
          }

          if (!checkHash(pin, u.pinHash)) {
            return send(res, 401, {
              error: 'Incorrect Security PIN'
            });
          }

          if (!Number.isFinite(amount) || amount < 10 ||
              amount > Number(u.balance || 0)) {
            return send(res, 400, {
              error: 'Minimum ₹10 and amount must not exceed available demo balance'
            });
          }

          if (!/^[\w.-]{2,}@[\w.-]{2,}$/.test(upi)) {
            return send(res, 400, { error: 'Enter a valid UPI ID' });
          }

          u.balance = roundMoney(u.balance - amount);

          const w = {
            id: id(),
            userId: u.id,
            name: u.name,
            phone: u.phone,
            amount,
            upi,
            status: 'pending',
            createdAt: new Date().toISOString()
          };

          db.withdrawals.unshift(w);

          record(
            u,
            'Withdrawal request',
            0,
            -amount,
            'pending',
            'Demo request; no payment sent'
          );

          persist();

          return send(res, 201, {
            withdrawal: w,
            user: userView(u)
          });
        }

        // REFERRAL
        if (req.method === 'GET' && p === '/api/referral') {
          return send(res, 200, {
            code: u.referralCode,
            inviteUrl: `${url.origin}/?ref=${u.referralCode}`
          });
        }

      } else {

        // ADMIN OVERVIEW
        if (req.method === 'GET' && p === '/api/admin/overview') {
          return send(res, 200, {
            users: db.users.map(userView),
            deposits: db.deposits,
            withdrawals: db.withdrawals,
            ledger: db.ledger.slice(0, 300),
            tasks: db.tasks,
            stats: {
              users: db.users.length,
              pending:
                db.withdrawals.filter(w => w.status === 'pending').length +
                db.deposits.filter(d => d.status === 'pending').length,
              totalDemoEarned: db.users.reduce(
                (sum, x) => sum + Number(x.earned || 0), 0
              )
            }
          });
        }

        // ADMIN: VERIFIED LEGACY ACCOUNT CREDENTIAL SETUP
        // Admin must independently verify account ownership before using this.
        if (req.method === 'POST' && p === '/api/admin/set-legacy-credentials') {
          const b = await read(req);
          const u = db.users.find(x => x.id === b.userId);
          const password = String(b.password || '');
          const pin = String(b.pin || '');

          if (!u) {
            return send(res, 404, { error: 'User not found' });
          }

          if (u.passwordHash) {
            return send(res, 409, {
              error: 'This account already has a password'
            });
          }

          if (!validPassword(password) || !validPin(pin)) {
            return send(res, 400, {
              error: 'Provide a password of at least 8 characters and a 6-digit PIN'
            });
          }

          u.passwordHash = makeHash(password);
          u.pinHash = makeHash(pin);
          u.credentialsUpdatedAt = new Date().toISOString();

          persist();

          record(
            u,
            'Account security setup',
            0,
            0,
            'success',
            'Legacy credentials set by Admin after ownership verification'
          );

          persist();

          return send(res, 200, {
            message: 'Legacy account credentials updated'
          });
        }

        // ADMIN APPROVE OR REJECT DEPOSIT
        if (req.method === 'POST' && p === '/api/admin/deposit') {
          const b = await read(req);
          const d = db.deposits.find(x => x.id === b.id);

          if (!d || d.status !== 'pending') {
            return send(res, 404, {
              error: 'Pending deposit not found'
            });
          }

          const u = db.users.find(x => x.id === d.userId);
          if (!u) {
            return send(res, 404, { error: 'User not found' });
          }

          if (b.action === 'approve') {
            const credit = roundMoney(d.usdt * USDT_RATE);

            u.balance = roundMoney(Number(u.balance || 0) + credit);
            d.status = 'approved_demo';
            d.approvedAmount = credit;
            d.reviewedAt = new Date().toISOString();

            record(
              u,
              'Demo USDT deposit approved',
              0,
              credit,
              'approved_demo',
              d.usdt + ' demo USDT × ₹' + USDT_RATE
            );

            // Direct referral commission only.
            if (u.referredBy && !d.referralCommission) {
              const referrer = db.users.find(x => x.id === u.referredBy);

              if (referrer) {
                const commission = roundMoney(
                  credit * REFERRAL_PERCENT / 100
                );

                referrer.balance = roundMoney(
                  Number(referrer.balance || 0) + commission
                );

                referrer.earned = roundMoney(
                  Number(referrer.earned || 0) + commission
                );

                d.referralCommission = commission;
                d.referrerUserId = referrer.id;

                record(
                  referrer,
                  'Direct referral commission',
                  0,
                  commission,
                  'success',
                  '1% of approved demo deposit'
                );
              }
            }

          } else if (b.action === 'reject') {
            d.status = 'rejected';
            d.reviewedAt = new Date().toISOString();

            record(
              u,
              'Demo deposit rejected',
              0,
              0,
              'rejected',
              'Admin rejected demo deposit request'
            );

          } else {
            return send(res, 400, { error: 'Invalid action' });
          }

          persist();
          return send(res, 200, { 
