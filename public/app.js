
const $ = id => document.getElementById(id);

let mode = 'register';
let token = localStorage.getItem('mea_token') || '';
let me = null;
let cache = null;

const USDT_RATE = 110;

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

async function api(url, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  const data = await response.json();

  if (!response.ok) {
    throw Error(data.error || 'Request failed');
  }

  return data;
}

// ---------------- AUTHENTICATION ----------------

function setMode(selectedMode) {
  mode = selectedMode;

  $('regTab').classList.toggle('selected', mode === 'register');
  $('loginTab').classList.toggle('selected', mode === 'login');

  $('nameField').classList.toggle('hidden', mode === 'login');
  $('name').required = mode === 'register';

  $('pinField').classList.toggle('hidden', mode === 'login');
  $('pin').required = mode === 'register';

  $('refField').classList.toggle('hidden', mode === 'login');
  $('password').autocomplete =
    mode === 'login' ? 'current-password' : 'new-password';

  $('password').placeholder =
    mode === 'login'
      ? 'Enter your password'
      : 'Create a password (minimum 8 characters)';

  $('password').minLength = mode === 'register' ? 8 : 1;

  $('authSubmit').textContent =
    mode === 'register' ? 'Create Account' : 'Login';
}

$('authForm').onsubmit = async event => {
  event.preventDefault();

  const phone = $('phone').value.replace(/\D/g, '');
  const password = $('password').value;

  if (phone.length !== 10) {
    toast('Enter a valid 10-digit mobile number.');
    return;
  }

  if (!password) {
    toast('Enter your login password.');
    return;
  }

  if (mode === 'register') {
    if (password.length < 8) {
      toast('Password must contain at least 8 characters.');
      return;
    }

    const pin = $('pin').value;

    if (!/^\d{4,6}$/.test(pin)) {
      toast('Security PIN must contain 4 to 6 digits.');
      return;
    }

    if (!$('name').value.trim()) {
      toast('Enter your full name.');
      return;
    }
  }

  $('authSubmit').disabled = true;

  try {
    const body = mode === 'register'
      ? {
          name: $('name').value.trim(),
          phone,
          password,
          pin: $('pin').value,
          referralCode: $('ref').value.trim()
        }
      : {
          phone,
          password
        };

    const data = await api('/api/' + mode, 'POST', body);

    token = data.token;
    localStorage.setItem('mea_token', token);

    $('authForm').reset();

    const success = await refresh();

    if (success) {
      toast(mode === 'register'
        ? 'Account created successfully.'
        : 'Login successful.');
    }

  } catch (error) {
    toast(error.message);
  } finally {
    $('authSubmit').disabled = false;
  }
};

// ---------------- USER DATA ----------------

async function refresh() {
  try {
    cache = await api('/api/me');
    me = cache.user;

    if (!me) throw Error('User data not found.');

    if (!Array.isArray(me.claimed)) me.claimed = [];
    if (!Array.isArray(cache.tasks)) cache.tasks = [];
    if (!Array.isArray(cache.transactions)) cache.transactions = [];
    if (!Array.isArray(cache.withdrawals)) cache.withdrawals = [];
    if (!Array.isArray(cache.deposits)) cache.deposits = [];

    render();

    $('auth').classList.add('hidden');
    $('app').classList.remove('hidden');

    return true;

  } catch (error) {
    token = '';
    localStorage.removeItem('mea_token');

    $('auth').classList.remove('hidden');
    $('app').classList.add('hidden');

    toast(error.message);
    return false;
  }
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function render() {
  $('userName').textContent = me.name || 'User';
  $('balance').textContent = money(me.balance);
  $('walletBalance').textContent = money(me.balance);
  $('earned').textContent = money(me.earned);
  $('coins').textContent = me.coins || 0;
  $('refCode').textContent = me.referralCode || '—';

  $('inviteUrl').textContent =
    location.origin + '/?ref=' + (me.referralCode || '');

  renderTasks();
  renderDeposits();

  $('ledger').innerHTML = cache.transactions.length
    ? cache.transactions.map(transaction => `
        <tr>
          <td>${esc(transaction.type)}</td>
          <td>${Number(transaction.coins || 0)}</td>
          <td>₹${money(transaction.amount)}</td>
          <td>
            <span class="pill ${statusClass(transaction.status)}">
              ${esc(transaction.status)}
            </span>
          </td>
        </tr>
      `).join('')
    : '<tr><td colspan="4">No transactions yet.</td></tr>';

  $('withdrawals').innerHTML = cache.withdrawals.length
    ? cache.withdrawals.map(withdrawal => `
        <div class="task">
          <b>₹${money(withdrawal.amount)}</b>
          • ${esc(withdrawal.status)}
          <p>${esc(withdrawal.upi || '')}</p>
          <p>${withdrawal.createdAt
            ? new Date(withdrawal.createdAt).toLocaleString('en-IN')
            : ''}</p>
        </div>
      `).join('')
    : '<p class="muted">No withdrawal requests yet.</p>';
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

function statusClass(status) {
  status = String(status || '').toLowerCase();

  return status.includes('reject')
    ? 'rejected'
    : status.includes('pending')
      ? 'pending'
      : 'success';
}

// ---------------- DEPOSIT SYSTEM ----------------

function updateDepositEstimate() {
  const amountInput = $('depositAmount');
  const estimate = $('depositEstimate');

  if (!amountInput || !estimate) return;

  const amount = Number(amountInput.value);

  estimate.textContent = amount > 0
    ? 'Estimated demo credit: ₹' + money(amount * USDT_RATE)
    : 'Estimated demo credit: ₹0.00';
}

$('depositAmount').addEventListener('input', updateDepositEstimate);

$('depositForm').onsubmit = async event => {
  event.preventDefault();

  const amount = Number($('depositAmount').value);
  const reference = $('depositReference').value.trim();

  if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
    toast('Enter an amount between 1 and 100000 USDT.');
    return;
  }

  if (reference.length < 4 || reference.length > 120) {
    toast('Demo reference must contain 4 to 120 characters.');
    return;
  }

  try {
    await api('/api/deposit', 'POST', {
      amount,
      reference
    });

    $('depositForm').reset();
    updateDepositEstimate();

    await refresh();
    showView('wallet');

    toast('Demo deposit request submitted.');

  } catch (error) {
    toast('Deposit error: ' + error.message);
  }
};

function renderDeposits() {
  const container = $('depositHistory');

  const deposits = Array.isArray(cache.deposits)
    ? cache.deposits
    : [];

  if (!deposits.length) {
    container.innerHTML =
      '<p class="muted">No demo deposit requests yet.</p>';
    return;
  }

  container.innerHTML = deposits.map(deposit => {
    const amount = Number(deposit.usdt ?? deposit.amount ?? 0);
    const inr = Number(
      deposit.inrAmount ?? amount * USDT_RATE
    );

    return `
      <div class="task">
        <b>${money(amount)} USDT</b>
        <p>Estimated Value: ₹${money(inr)}</p>
        <p>Reference: ${esc(deposit.reference || '')}</p>
        <p>
          Status:
          <span class="pill ${statusClass(deposit.status)}">
            ${esc(deposit.status || 'pending')}
          </span>
        </p>
        <p>${deposit.createdAt
          ? new Date(deposit.createdAt).toLocaleString('en-IN')
          : ''}</p>
      </div>
    `;
  }).join('');
}

// ---------------- TASK SYSTEM ----------------

function renderTasks() {
  const tasks = Array.isArray(cache.tasks)
    ? cache.tasks.filter(task => task.id !== 'daily')
    : [];

  const claimed = Array.isArray(me.claimed)
    ? me.claimed
    : [];

  const html = tasks.map(task => {
    const done = claimed.includes(task.id);

    return `
      <article class="task">
        <div class="emoji">${task.id === 'offer' ? '🎯' : '⭐'}</div>
        <h3>${esc(task.title)}</h3>
        <p>${esc(task.description)}</p>
        <div class="reward">🪙 ${Number(task.coins || 0)} coins</div>
        <button
          class="btn ${done ? 'ghost' : 'primary'}"
          data-task-id="${esc(task.id)}"
          ${done ? 'disabled' : ''}>
          ${done ? 'Claimed' : 'Claim Reward'}
        </button>
      </article>
    `;
  }).join('');

  const empty = '<p class="muted">No tasks available right now.</p>';

  $('homeTasks').innerHTML = html || empty;
  $('allTasks').innerHTML = html || empty;

  document.querySelectorAll('[data-task-id]').forEach(button => {
    button.addEventListener('click', () => {
      claim(button.dataset.taskId);
    });
  });
}

async function claim(taskId) {
  try {
    await api('/api/claim', 'POST', { taskId });
    await refresh();
    toast('Demo reward coins added.');
  } catch (error) {
    toast(error.message);
  }
}

// ---------------- WITHDRAWAL SYSTEM ----------------

function openWithdraw() {
  if (!me) return;

  $('amount').max = Number(me.balance || 0);
  $('withdrawForm').reset();
  $('modal').classList.remove('hidden');
}

function closeModal() {
  $('modal').classList.add('hidden');
}

$('withdrawForm').onsubmit = async event => {
  event.preventDefault();

  const amount = Number($('amount').value);
  const upi = $('upi').value.trim();
  const pin = $('withdrawPin').value;

  if (!Number.isFinite(amount) || amount < 10) {
    toast('Minimum demo withdrawal amount is ₹10.');
    return;
  }

  if (!/^\d{4,6}$/.test(pin)) {
    toast('Enter your 4 to 6 digit Security PIN.');
    return;
  }

  try {
    await api('/api/withdraw', 'POST', {
      amount,
      upi,
      pin
    });

    closeModal();
    await refresh();
    showView('wallet');

    toast('Demo withdrawal request submitted.');

  } catch (error) {
    toast('Withdrawal error: ' + error.message);
  }
};

// ---------------- REFERRAL SYSTEM ----------------

async function copyCode() {
  try {
    await navigator.clipboard.writeText(me.referralCode);
    toast('Referral code copied.');
  } catch {
    toast('Your referral code: ' + me.referralCode);
  }
}

// ---------------- NAVIGATION ----------------

function showView(viewName) {
  document.querySelectorAll('.view').forEach(view => {
    view.classList.add('hidden');
  });

  const selectedView = $('view-' + viewName);

  if (selectedView) {
    selectedView.classList.remove('hidden');
  }

  document.querySelectorAll('.nav button').forEach(button => {
    button.classList.toggle(
      'active',
      button.dataset.view === viewName
    );
  });
}

document.querySelectorAll('.nav button').forEach(button => {
  button.addEventListener('click', () => {
    showView(button.dataset.view);
  });
});

// ---------------- LOGOUT ----------------

function logout() {
  token = '';
  localStorage.removeItem('mea_token');

  me = null;
  cache = null;

  $('app').classList.add('hidden');
  $('auth').classList.remove('hidden');

  $('authForm').reset();
  setMode('login');
}

// ---------------- START APP ----------------

const params = new URLSearchParams(location.search);

if (params.get('ref')) {
  $('ref').value = params.get('ref');
}

setMode('register');

if (token) {
  refresh();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
