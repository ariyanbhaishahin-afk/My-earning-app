
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DB = path.join(ROOT, 'data.json');
const PORT = Number(process.env.PORT || 3000);

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
const SECRET = process.env.APP_SECRET || 'development-only-change-this-secret';

const COIN_RATE = 100;
const USDT_RATE = 110;
const REFERRAL_PERCENT = 1;

let db = fs.existsSync(DB)
  ? JSON.parse(fs.readFileSync(DB, 'utf8'))
  : { users: [], withdrawals: [], deposits: [], ledger: [], tasks: [
      {id:'daily',title:'Daily check-in',description:'Open the app and claim your daily demo reward',coins:10,active:true},
      {id:'offer',title:'Explore an offer',description:'Try a sample offer task',coins:25,active:true},
      {id:'profile',title:'Complete profile',description:'Complete your demo profile',coins:15,active:true}
    ] };

db.users ||= [];
db.withdrawals ||= [];
db.deposits ||= [];
db.ledger ||= [];
db.tasks ||= [];

function persist() {
  const tmp = DB + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB);
}

function id() {
  return crypto.randomBytes(12).toString('hex');
}

function hash(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function token(payload) {
  const body = Buffer.from(JSON.stringify({
    ...payload,
    exp: Date.now() + 7 * 864e5
  })).toString('base64url');

  const sig = crypto.createHmac('sha256', SECRET)
    .update(body).digest('base64url');

  return body + '.' + sig;
}

function verify(t) {
  try {
    const [b, s] = String(t || '').split('.');
    if (!b || !s) return null;

    const expected = crypto.createHmac('sha256', SECRET)
      .update(b).digest('base64url');

    const a = Buffer.from(s);
    const e = Buffer.from(expected);

    if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return null;

    const p = JSON.parse(Buffer.from(b, 'base64url'));
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

function send(res, status, obj, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers
  });
  res.end(JSON.stringify(obj));
}

function read(req) {
  return new Promise((resolve, reject) => {
    let s = '';

    req.on('data', c => {
      s += c;
      if (s.length > 1e6) reject(Error('Too large'));
    });

    req.on('end', () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch {
        reject(Error('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
}

function auth(req, role) {
  const p = verify((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  return p && (!role || p.role === role) ? p : null;
}

function userView(u) {
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    referralCode: u.referralCode,
    balance: u.balance,
    coins: u.coins,
    earned: u.earned,
    createdAt: u.createdAt
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

function roundMoney(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (req.method === 'GET' && p === '/health') {
      return send(res, 200, { ok: true, app: 'My Earning App Demo' });
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

      if (name.length < 2 || phone.length !== 10) {
        return send(res, 400, { error: 'Name and 10-digit mobile number are required' });
      }

      if (db.users.some(x => x.phone === phone)) {
        return send(res, 409, { error: 'This mobile number is already registered' });
      }

      const u = {
        id: id(),
        name,
        phone,
        referralCode: 'MY' + phone.slice(-4) +
          crypto.randomBytes(2).toString('hex').toUpperCase(),
        balance: 0,
        coins: 0,
        earned: 0,
        claimed: [],
        createdAt: new Date().toISOString()
      };

      const ref = String(b.referralCode || '').trim().toUpperCase();

      if (ref) {
        const inviter = db.users.find(x => x.referralCode === ref);

        if (inviter && inviter.id !== u.id) {
          u.referredBy = inviter.id;
        }
      }

      // No signup referral bonus.
      db.users.push(u);
      persist();

      return send(res, 201, {
        token: token({ sub: u.id, role: 'user' }),
        user: userView(u)
      });
    }

    // USER LOGIN
    if (req.method === 'POST' && p === '/api/login') {
      const b = await read(req);
      const phone = String(b.phone || '').replace(/\D/g, '');
      const u = db.users.find(x => x.phone === phone);

      if (!u) {
        return send(res, 404, { error: 'Account not found. Please register first.' });
      }

      return send(res, 200, {
        token: token({ sub: u.id, role: 'user' }),
        user: userView(u)
      });
    }

    // ADMIN LOGIN
    if (req.method === 'POST' && p === '/api/admin/login') {
      const b = await read(req);

      const validUser = String(b.username) === ADMIN_USER;
      const validPassword = crypto.timingSafeEqual(
        Buffer.from(hash(String(b.password || ''))),
        Buffer.from(hash(ADMIN_PASSWORD))
      );

      if (!validUser || !validPassword) {
        return send(res, 401, { error: 'Invalid admin credentials' });
      }

      return send(res, 200, {
        token: token({ sub: 'admin', role: 'admin' }),
        role: 'admin'
      });
    }

    // AUTHENTICATED API
    if (p.startsWith('/api/')) {
      const isAdmin = p.startsWith('/api/admin/');
      const session = auth(req, isAdmin ? 'admin' : 'user');

      if (!session) return send(res, 401, { error: 'Please sign in again' });

      if (!isAdmin) {
        const u = db.users.find(x => x.id === session.sub);
        if (!u) return send(res, 401, { error: 'User not found' });

        u.claimed ||= [];

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

        // DEMO USDT DEPOSIT REQUEST
        if (req.method === 'POST' && p === '/api/deposit') {
          const b = await read(req);
          const amount = Number(b.amount);
          const reference = String(b.reference || '').trim();

          if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
            return send(res, 400, { error: 'Enter a valid demo USDT amount (minimum 1)' });
          }

          if (reference.length < 4 || reference.length > 120) {
            return send(res, 400, { error: 'Enter a demo reference (4–120 characters)' });
          }

          const duplicate = db.deposits.some(
            d => d.reference.toLowerCase() === reference.toLowerCase()
          );

          if (duplicate) {
            return send(res, 409, { error: 'This reference has already been submitted' });
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
          record(u, 'Demo USDT deposit request', 0, 0, 'pending',
            amount + ' demo USDT; reference: ' + reference);

          persist();

          return send(res, 201, { deposit });
        }

        // CLAIM TASK
        if (req.method === 'POST' && p === '/api/claim') {
          const b = await read(req);
          const t = db.tasks.find(x => x.id === b.taskId && x.active);

          if (!t) return send(res, 404, { error: 'Task not available' });
          if (u.claimed.includes(t.id)) {
            return send(res, 409, { error: 'Reward already claimed' });
          }

          u.claimed.push(t.id);
          u.coins += t.coins;

          const amount = t.coins / COIN_RATE;
          u.balance += amount;
          u.earned += amount;

          record(u, t.title, t.coins, amount);
          persist();

          return send(res, 200, { user: userView(u) });
        }

        // DEMO WITHDRAWAL
        if (req.method === 'POST' && p === '/api/withdraw') {
          const b = await read(req);
          const amount = Number(b.amount);
          const upi = String(b.upi || '').trim();

          if (!Number.isFinite(amount) || amount < 10 || amount > u.balance) {
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
          record(u, 'Withdrawal request', 0, -amount, 'pending',
            'Demo request; no payment sent');

          persist();

          return send(res, 201, { withdrawal: w, user: userView(u) });
        }

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
              totalDemoEarned: db.users.reduce((s, u) => s + (u.earned || 0), 0)
            }
          });
        }

        // ADMIN APPROVE OR REJECT DEPOSIT
        if (req.method === 'POST' && p === '/api/admin/deposit') {
          const b = await read(req);
          const d = db.deposits.find(x => x.id === b.id);

          if (!d || d.status !== 'pending') {
            return send(res, 404, { error: 'Pending deposit not found' });
          }

          const u = db.users.find(x => x.id === d.userId);
          if (!u) return send(res, 404, { error: 'User not found' });

          if (b.action === 'approve') {
            const credit = roundMoney(d.usdt * USDT_RATE);

            u.balance = roundMoney((u.balance || 0) + credit);
            d.status = 'approved_demo';
            d.approvedAmount = credit;
            d.reviewedAt = new Date().toISOString();

            record(u, 'Demo USDT deposit approved', 0, credit,
              'approved_demo', d.usdt + ' demo USDT × ₹' + USDT_RATE);

            // Direct referral commission: only for approved deposit.
            if (u.referredBy) {
              const referrer = db.users.find(x => x.id === u.referredBy);

              if (referrer) {
                const commission = roundMoney(credit * REFERRAL_PERCENT / 100);

                referrer.balance = roundMoney((referrer.balance || 0) + commission);
                referrer.earned = roundMoney((referrer.earned || 0) + commission);

                d.referralCommission = commission;
                d.referrerUserId = referrer.id;

                record(referrer, 'Direct referral commission', 0,
                  commission, 'success',
                  '1% of approved demo deposit from ' + u.name);
              }
            }

          } else if (b.action === 'reject') {
            d.status = 'rejected';
            d.reviewedAt = new Date().toISOString();

            record(u, 'Demo deposit rejected', 0, 0,
              'rejected', 'Admin rejected demo deposit request');

          } else {
            return send(res, 400, { error: 'Invalid action' });
          }

          persist();
          return send(res, 200, { deposit: d });
        }

        // ADMIN APPROVE OR REJECT WITHDRAWAL
        if (req.method === 'POST' && p === '/api/admin/withdrawal') {
          const b = await read(req);
          const w = db.withdrawals.find(x => x.id === b.id);

          if (!w || w.status !== 'pending') {
            return send(res, 404, { error: 'Pending request not found' });
          }

          const u = db.users.find(x => x.id === w.userId);
          if (!u) return send(res, 404, { error: 'User not found' });

          if (b.action === 'approve') {
            w.status = 'approved_demo';
            record(u, 'Withdrawal approved (demo)', 0, 0,
              'approved_demo', 'No funds transferred');

          } else if (b.action === 'reject') {
            w.status = 'rejected';
            u.balance = roundMoney((u.balance || 0) + w.amount);
            record(u, 'Withdrawal refund', 0, w.amount,
              'success', 'Demo refund after rejection');

          } else {
            return send(res, 400, { error: 'Invalid action' });
          }

          w.reviewedAt = new Date().toISOString();
          persist();

          return send(res, 200, { withdrawal: w });
        }

        // ADMIN MANUAL DEMO CREDIT
        if (req.method === 'POST' && p === '/api/admin/credit') {
          const b = await read(req);
          const u = db.users.find(x => x.id === b.userId);
          const coins = Math.floor(Number(b.coins));

          if (!u || coins < 1 || coins > 100000) {
            return send(res, 400, { error: 'Choose a user and valid coin amount' });
          }

          const amount = coins / COIN_RATE;
          u.coins += coins;
          u.balance += amount;
          u.earned += amount;

          record(u, 'Admin reward credit', coins, amount,
            'success', 'Admin demo credit');

          persist();
          return send(res, 200, { user: userView(u) });
        }

        // ADMIN TASK SETTINGS
        if (req.method === 'POST' && p === '/api/admin/task') {
          const b = await read(req);
          const t = db.tasks.find(x => x.id === b.id);

          if (!t) return send(res, 404, { error: 'Task not found' });

          if (typeof b.active === 'boolean') t.active = b.active;

          if (b.coins !== undefined) {
            const n = Math.floor(Number(b.coins));
            if (n < 1 || n > 10000) {
              return send(res, 400, { error: 'Invalid coin value' });
            }
            t.coins = n;
          }

          persist();
          return send(res, 200, { task: t });
        }
      }

      return send(res, 404, { error: 'API route not found' });
    }

    // STATIC FILES
    const file = p === '/' ? 'index.html' : p.replace(/^\//, '');
    const full = path.resolve(PUBLIC, file);

    if (!full.startsWith(PUBLIC + path.sep) &&
        full !== path.join(PUBLIC, 'index.html')) {
      return send(res, 403, { error: 'Forbidden' });
    }

    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      return send(res, 404, { error: 'Not found' });
    }

    const ext = path.extname(full);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json'
    };

    res.writeHead(200, {
      'content-type': types[ext] || 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-cache'
    });

    fs.createReadStream(full).pipe(res);

  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`My Earning App demo running at http://localhost:${PORT}`);
});
