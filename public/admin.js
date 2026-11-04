
let at = localStorage.getItem('mea_admin_token') || '';
let snapshot = null;

const $ = id => document.getElementById(id);

function toast(message) {
  const t = $('toast');
  if (!t) {
    alert(message);
    return;
  }

  t.textContent = message;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

async function api(url, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(at ? { authorization: 'Bearer ' + at } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  const data = await response.json();

  if (!response.ok) {
    throw Error(data.error || 'Request failed');
  }

  return data;
}

// ---------------- ADMIN LOGIN ----------------

$('adminForm').onsubmit = async event => {
  event.preventDefault();

  const button = $('adminForm').querySelector('button[type="submit"]');
  button.disabled = true;

  try {
    const data = await api('/api/admin/login', 'POST', {
      username: $('adminUser').value.trim(),
      password: $('adminPass').value
    });

    at = data.token;
    localStorage.setItem('mea_admin_token', at);

    $('adminPass').value = '';

    await loadAdmin();
    toast('Admin login successful.');

  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
};

// ---------------- LOAD DASHBOARD ----------------

async function loadAdmin() {
  try {
    snapshot = await api('/api/admin/overview');

    $('adminLogin').classList.add('hidden');
    $('adminApp').classList.remove('hidden');

    render();

  } catch (error) {
    at = '';
    localStorage.removeItem('mea_admin_token');

    $('adminLogin').classList.remove('hidden');
    $('adminApp').classList.add('hidden');

    if (error.message) toast(error.message);
  }
}

// ---------------- DASHBOARD RENDER ----------------

function render() {
  const s = snapshot || {};

  const stats = s.stats || {};
  const deposits = Array.isArray(s.deposits) ? s.deposits : [];
  const withdrawals = Array.isArray(s.withdrawals) ? s.withdrawals : [];
  const users = Array.isArray(s.users) ? s.users : [];
  const tasks = Array.isArray(s.tasks) ? s.tasks : [];
  const ledger = Array.isArray(s.ledger) ? s.ledger : [];

  $('usersCount').textContent = stats.users || 0;
  $('pendingCount').textContent = stats.pending || 0;
  $('earnedTotal').textContent =
    '₹' + Number(stats.totalDemoEarned || 0).toFixed(2);
  $('txCount').textContent = ledger.length;

  // DEPOSIT REQUESTS

  $('depositRows').innerHTML = deposits.length
    ? deposits.map(d => {
        const amount = Number(d.usdt ?? d.amount ?? 0);

        return `
          <tr>
            <td>
              ${esc(d.name)}
              <br><small>${esc(d.phone)}</small>
            </td>
            <td>${amount.toFixed(2)} USDT</td>
            <td>₹${Number(d.inrAmount || 0).toFixed(2)}</td>
            <td>${esc(d.reference)}</td>
            <td>${esc(d.status)}</td>
            <td>
              ${d.status === 'pending' ? `
                <button class="btn primary"
                  onclick="decideDeposit('${esc(d.id)}','approve')">
                  Approve
                </button>
                <button class="btn"
                  onclick="decideDeposit('${esc(d.id)}','reject')">
                  Reject
                </button>
              ` : '—'}
            </td>
          </tr>
        `;
      }).join('')
    : '<tr><td colspan="6">No deposit requests yet.</td></tr>';

  // WITHDRAWAL REQUESTS

  $('withdrawRows').innerHTML = withdrawals.length
    ? withdrawals.map(w => `
        <tr>
          <td>
            ${esc(w.name)}
            <br><small>${esc(w.phone)}</small>
          </td>
          <td>₹${Number(w.amount || 0).toFixed(2)}</td>
          <td>${esc(w.upi)}</td>
          <td>${esc(w.status)}</td>
          <td>
            ${w.status === 'pending' ? `
              <button class="btn primary"
                onclick="decide('${esc(w.id)}','approve')">
                Approve
              </button>
              <button class="btn"
                onclick="decide('${esc(w.id)}','reject')">
                Reject
              </button>
            ` : '—'}
          </td>
        </tr>
      `).join('')
    : '<tr><td colspan="5">No withdrawal requests yet.</td></tr>';

  // USERS

  $('userRows').innerHTML = users.length
    ? users.map(u => `
        <tr>
          <td>
            ${esc(u.name)}
            <br><small>${esc(u.phone)}</small>
            <br><small>User ID: ${esc(u.id)}</small>
          </td>
          <td>₹${Number(u.balance || 0).toFixed(2)}</td>
          <td>${Number(u.coins || 0)}</td>
          <td>
            <button class="btn"
              onclick="credit('${esc(u.id)}')">
              Add
            </button>
          </td>
        </tr>
      `).join('')
    : '<tr><td colspan="4">No users found.</td></tr>';

  // TASK SETTINGS

  $('taskRows').innerHTML = tasks.length
    ? tasks.filter(t => t.id !== 'daily').map(t => `
        <div class="task-setting">
          <div>
            <b>${esc(t.title)}</b>
            <br>
            <small class="muted">${t.active ? 'Active' : 'Paused'}</small>
          </div>

          <input type="number"
            min="1"
            max="10000"
            id="coins-${esc(t.id)}"
            value="${Number(t.coins || 0)}">

          <button class="btn"
            onclick="saveTask('${esc(t.id)}',${!t.active})">
            ${t.active ? 'Pause' : 'Activate'}
          </button>

          <button class="btn primary"
            onclick="saveTask('${esc(t.id)}',null)">
            Save Coins
          </button>
        </div>
      `).join('')
    : '<p class="muted">No reward tasks available.</p>';

  // RECENT LEDGER

  $('ledgerRows').innerHTML = ledger.length
    ? ledger.map(t => `
        <tr>
          <td>${esc(t.type)}</td>
          <td>₹${Number(t.amount || 0).toFixed(2)}</td>
          <td>${esc(t.status)}</td>
          <td>${t.createdAt
            ? new Date(t.createdAt).toLocaleString('en-IN')
            : '—'}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="4">No ledger entries.</td></tr>';
}

// ---------------- DEPOSIT APPROVAL ----------------

async function decideDeposit(id, action) {
  const message = action === 'approve'
    ? 'Approve this DEMO deposit request?'
    : 'Reject this DEMO deposit request?';

  if (!confirm(message)) return;

  try {
    await api('/api/admin/deposit', 'POST', { id, action });
    await loadAdmin();

    toast(action === 'approve'
      ? 'Demo deposit approved.'
      : 'Demo deposit rejected.');

  } catch (error) {
    toast(error.message);
  }
}

// ---------------- WITHDRAWAL APPROVAL ----------------

async function decide(id, action) {
  const message = action === 'approve'
    ? 'Mark this demo withdrawal as approved? No real payment will be sent.'
    : 'Reject this demo withdrawal and refund the demo balance?';

  if (!confirm(message)) return;

  try {
    await api('/api/admin/withdrawal', 'POST', { id, action });
    await loadAdmin();

    toast(action === 'approve'
      ? 'Withdrawal marked demo-approved.'
      : 'Withdrawal rejected and demo balance refunded.');

  } catch (error) {
    toast(error.message);
  }
}

// ---------------- USER CREDIT ----------------

async function credit(userId) {
  const input = prompt('How many demo coins should be added?', '100');

  if (input === null) return;

  const coins = Number(input);

  if (!Number.isSafeInteger(coins) || coins < 1) {
    toast('Enter a valid positive whole number of coins.');
    return;
  }

  if (!confirm(`Add ${coins} demo coins to this user?`)) return;

  try {
    await api('/api/admin/credit', 'POST', {
      userId,
      coins
    });

    await loadAdmin();
    toast('Demo coins added.');

  } catch (error) {
    toast(error.message);
  }
}

// ---------------- TASK SETTINGS ----------------

async function saveTask(id, active) {
  const input = $('coins-' + id);
  const coins = Number(input.value);

  if (!Number.isSafeInteger(coins) || coins < 1 || coins > 10000) {
    toast('Enter a valid task reward between 1 and 10000 coins.');
    return;
  }

  try {
    await api('/api/admin/task', 'POST', {
      id,
      coins,
      ...(active === null ? {} : { active })
    });

    await loadAdmin();
    toast('Task settings saved.');

  } catch (error) {
    toast(error.message);
  }
}

// ---------------- LEGACY ACCOUNT RECOVERY ----------------

$('legacyForm').onsubmit = async event => {
  event.preventDefault();

  const userId = $('legacyUserId').value.trim();
  const password = $('legacyPassword').value;
  const pin = $('legacyPin').value;
  const verified = $('legacyVerified').checked;

  if (!userId) {
    toast('Enter the exact existing user ID.');
    return;
  }

  if (password.length < 8) {
    toast('New password must contain at least 8 characters.');
    return;
  }

  if (!/^\d{4,6}$/.test(pin)) {
    toast('Security PIN must contain 4 to 6 digits.');
    return;
  }

  if (!verified) {
    toast('Verify the account owner identity first.');
    return;
  }

  if (!confirm(
    'Confirm that you independently verified this account owner and want to reset their login password and Security PIN?'
  )) return;

  try {
    await api('/api/admin/set-legacy-credentials', 'POST', {
      userId,
      password,
      pin,
      identityVerified: true
    });

    $('legacyForm').reset();
    toast('Legacy credentials updated.');

  } catch (error) {
    toast(error.message);
  }
};

// ---------------- ADMIN LOGOUT ----------------

function adminLogout() {
  at = '';
  snapshot = null;

  localStorage.removeItem('mea_admin_token');

  $('adminApp').classList.add('hidden');
  $('adminLogin').classList.remove('hidden');
  $('adminForm').reset();

  toast('Admin logged out.');
}

// ---------------- START ----------------

if (at) {
  loadAdmin();
}
