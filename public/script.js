const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

const state = {
  token: localStorage.getItem('brigadeplanner_token') || '',
  user: null
};

const loginPane = document.getElementById('loginPane');
const workspace = document.getElementById('workspace');
const loginError = document.getElementById('loginError');
const syncState = document.getElementById('syncState');
const userName = document.getElementById('userName');
const taskList = document.getElementById('taskList');

if (tg) {
  tg.ready();
  tg.expand();
}

document.getElementById('loginButton').addEventListener('click', loginWithPassword);
document.getElementById('refreshButton').addEventListener('click', loadWorkspace);

boot();

async function boot() {
  try {
    if (tg && tg.initData) {
      await loginWithTelegram(tg.initData);
      return;
    }

    if (state.token) {
      await loadWorkspace();
      return;
    }
  } catch (error) {
    state.token = '';
    localStorage.removeItem('brigadeplanner_token');
  }

  showLogin();
}

async function loginWithTelegram(initData) {
  const response = await post('/api/auth/telegram', { initData }, false);
  setSession(response);
  await loadWorkspace();
}

async function loginWithPassword() {
  loginError.textContent = '';
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();

  try {
    const response = await post('/api/auth/login', { username, password }, false);
    setSession(response);
    await loadWorkspace();
  } catch (error) {
    loginError.textContent = 'Доступ не подтвержден';
  }
}

function setSession(response) {
  state.token = response.token;
  state.user = response.user;
  localStorage.setItem('brigadeplanner_token', state.token);
}

async function loadWorkspace() {
  setSync('sync');
  const [me, dashboard, tasks] = await Promise.all([
    get('/api/users/me'),
    get('/api/brigadier/dashboard'),
    get('/api/brigadier/tasks/today')
  ]);

  state.user = me;
  userName.textContent = me.fullName || me.username || 'План работ';
  document.getElementById('todayTotal').textContent = dashboard.todayTotal;
  document.getElementById('todayInProgress').textContent = dashboard.todayInProgress;
  document.getElementById('todayOverdue').textContent = dashboard.todayOverdue;
  renderTasks(tasks);
  showWorkspace();
  setSync('online');
}

function renderTasks(tasks) {
  taskList.innerHTML = '';

  if (!tasks.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Задач на сегодня нет';
    taskList.appendChild(empty);
    return;
  }

  tasks.forEach(task => {
    const row = document.createElement('button');
    row.className = 'task-row';
    row.type = 'button';
    row.addEventListener('click', () => openTask(task));

    const text = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'task-title';
    title.textContent = task.title;
    const meta = document.createElement('div');
    meta.className = 'task-meta';
    meta.textContent = [task.siteName, formatDate(task.endDate)].filter(Boolean).join(' · ');
    text.append(title, meta);

    const status = document.createElement('div');
    status.className = 'status';
    status.textContent = task.taskStatusName || 'Статус';

    row.append(text, status);
    taskList.appendChild(row);
  });
}

function openTask(task) {
  if (tg && tg.HapticFeedback) {
    tg.HapticFeedback.impactOccurred('light');
  }

  if (tg && tg.MainButton) {
    tg.MainButton.setText('Открыть #' + task.taskId);
    tg.MainButton.show();
    tg.MainButton.onClick(() => {
      tg.sendData(JSON.stringify({ action: 'open_task', taskId: task.taskId }));
      tg.close();
    });
  }
}

async function get(url) {
  const response = await fetch(url, {
    headers: authHeaders()
  });
  return readJson(response);
}

async function post(url, body, useAuth = true) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(useAuth ? authHeaders() : {})
    },
    body: JSON.stringify(body)
  });
  return readJson(response);
}

async function readJson(response) {
  if (!response.ok) {
    throw new Error(String(response.status));
  }
  return response.json();
}

function authHeaders() {
  return state.token ? { Authorization: 'Bearer ' + state.token } : {};
}

function showLogin() {
  loginPane.hidden = false;
  workspace.hidden = true;
  setSync('offline');
}

function showWorkspace() {
  loginPane.hidden = true;
  workspace.hidden = false;
}

function setSync(value) {
  syncState.classList.toggle('online', value === 'online');
  syncState.textContent = value;
}

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit'
  }).format(new Date(value));
}
