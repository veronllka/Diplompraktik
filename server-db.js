const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'brigadeplanner-db.json');
const TOKEN_SECRET = process.env.JWT_SECRET || process.env.TOKEN_SECRET || 'brigadeplanner-miniapp-local-secret';
const TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR || path.join(DATA_DIR, 'attachments');
const configuredMaxRequestBodyBytes = Number(process.env.MAX_REQUEST_BODY_BYTES || 15_000_000);
const MAX_REQUEST_BODY_BYTES = Number.isFinite(configuredMaxRequestBodyBytes)
  ? Math.max(1_000_000, configuredMaxRequestBodyBytes)
  : 15_000_000;
const configuredPasswordIterations = Number(process.env.PASSWORD_ITERATIONS || 60000);
const PASSWORD_ITERATIONS = Number.isFinite(configuredPasswordIterations)
  ? Math.max(20000, configuredPasswordIterations)
  : 60000;

const permissions = {
  dashboardView: 'dashboard.view',
  sitesView: 'sites.view',
  sitesManage: 'sites.manage',
  crewsView: 'crews.view',
  crewsManage: 'crews.manage',
  crewMembersManage: 'crew_members.manage',
  tasksView: 'tasks.view',
  tasksManage: 'tasks.manage',
  tasksDuplicate: 'tasks.duplicate',
  calendarView: 'calendar.view',
  reportsView: 'reports.view',
  reportsExport: 'reports.export',
  materialRequestsView: 'material_requests.view',
  materialRequestsManage: 'material_requests.manage',
  dailyPlanView: 'daily_plan.view'
};

const allPermissions = Object.values(permissions);

let isDatabaseInitialized = false;
let indexes;
let db = loadDatabase();
indexes = buildIndexes(db);
isDatabaseInitialized = true;

async function handleApi(req, res) {
  try {
    const requestUrl = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(requestUrl.pathname).replace(/\/+$/, '') || '/';
    const method = req.method || 'GET';
    const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(req) : null;
    const user = getAuthenticatedUser(req);

    if (method === 'GET' && pathname === '/api/health') {
      return json(res, 200, { ok: true, database: DB_FILE });
    }

    if (method === 'GET' && pathname.startsWith('/api/attachments/')) {
      return serveAttachment(res, routeParts(pathname)[1]);
    }

    if (method === 'POST' && pathname === '/api/auth/login') {
      return login(res, body || {});
    }

    if (method === 'POST' && pathname === '/api/auth/telegram') {
      return telegramLogin(res);
    }

    if (!user) {
      return json(res, 401, { error: 'Unauthorized' });
    }

    const route = routeParts(pathname);

    if (method === 'GET' && pathname === '/api/users/me') {
      return json(res, 200, userDto(user));
    }

    if (method === 'GET' && pathname === '/api/permissions/my') {
      return json(res, 200, defaultPermissions(user.role));
    }

    if (method === 'POST' && pathname === '/api/attachments') {
      return uploadAttachment(res, body || {});
    }

    if (route[0] === 'users') {
      return handleUsers(res, method, route, body, user);
    }

    if (route[0] === 'roles') {
      return handleRoles(res, method, route, body);
    }

    if (route[0] === 'sites') {
      return handleSites(res, method, route, body);
    }

    if (route[0] === 'crews') {
      return handleCrews(res, method, route, body);
    }

    if (route[0] === 'tasks') {
      return handleTasks(res, method, route, body, requestUrl.searchParams, user);
    }

    if (route[0] === 'task-reports') {
      return handleTaskReports(res, method, route, user);
    }

    if (method === 'GET' && pathname === '/api/task-statuses') {
      return json(res, 200, db.taskStatuses.map(s => ({ taskStatusId: s.taskStatusId, taskStatusName: s.taskStatusName })));
    }

    if (method === 'GET' && pathname === '/api/priorities') {
      return json(res, 200, db.priorities.map(p => ({ priorityId: p.priorityId, priorityName: p.priorityName })));
    }

    if (method === 'GET' && pathname === '/api/dashboard') {
      return json(res, 200, dashboardDto());
    }

    if (route[0] === 'admin') {
      return handleAdmin(res, method, route, body, user);
    }

    if (route[0] === 'reports') {
      return handleReports(res, method, route);
    }

    if (route[0] === 'brigadier') {
      return handleBrigadier(res, method, route, body, requestUrl.searchParams, user);
    }

    if (route[0] === 'materials') {
      return handleMaterials(res, method, route, requestUrl.searchParams, body);
    }

    if (route[0] === 'material-requests') {
      return handleMaterialRequests(res, method, route, body, user);
    }

    if (route[0] === 'daily-plan') {
      return handleDailyPlan(res, method, route, body, requestUrl.searchParams);
    }

    return json(res, 404, { error: 'API endpoint not found' });
  } catch (error) {
    console.error('API error:', error);
    return json(res, 500, { error: 'Server error', detail: error.message });
  }
}

async function login(res, body) {
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const user = db.users.find(item => item.isActive !== false && item.username === username);

  if (!user || !(await verifyPassword(password, user))) {
    return json(res, 401, { error: 'Invalid username or password' });
  }

  return json(res, 200, { token: createToken(user), user: userDto(user) });
}

function telegramLogin(res) {
  const user = db.users.find(item => item.username === '3') || db.users[0];
  return json(res, 200, { token: createToken(user), user: userDto(user) });
}

async function handleUsers(res, method, route, body, currentUser) {
  if (method === 'POST' && route[1] === 'change-password') {
    if (!(await verifyPassword(String(body.oldPassword || ''), currentUser))) {
      return json(res, 400, { error: 'Неверный текущий пароль' });
    }

    setUserPassword(currentUser, String(body.newPassword || ''));
    saveDatabase();
    return noContent(res);
  }

  if (method === 'GET' && route.length === 1) {
    return json(res, 200, db.users.filter(u => u.isActive !== false).map(userDto));
  }

  if (method === 'POST' && route.length === 1) {
    const created = {
      userId: nextId('users', 'userId'),
      username: String(body.username || '').trim(),
      fullName: String(body.fullName || '').trim(),
      roleId: Number(body.roleId || 2),
      isActive: true,
      preferredTheme: 'Light',
      accentColor: 'Brown',
      telegramId: body.telegramId || null
    };
    setUserPassword(created, String(body.password || '123456'));
    db.users.push(created);
    saveDatabase();
    return json(res, 200, { userId: created.userId });
  }

  const userId = Number(route[1]);
  const user = db.users.find(item => item.userId === userId);
  if (!user) return json(res, 404, { error: 'User not found' });

  if (method === 'GET' && route.length === 2) {
    return json(res, 200, userDto(user));
  }

  if (method === 'PUT' && route.length === 2) {
    user.username = String(body.username || user.username).trim();
    user.fullName = String(body.fullName || user.fullName).trim();
    user.roleId = Number(body.roleId || user.roleId);
    if (body.telegramId !== undefined) user.telegramId = body.telegramId;
    if (body.password) setUserPassword(user, String(body.password));
    saveDatabase();
    return noContent(res);
  }

  if (method === 'DELETE' && route.length === 2) {
    user.isActive = false;
    saveDatabase();
    return noContent(res);
  }

  if (method === 'PUT' && route[2] === 'role') {
    user.roleId = Number(body.roleId || user.roleId);
    saveDatabase();
    return noContent(res);
  }

  if (method === 'PUT' && route[2] === 'settings') {
    if (body.newPassword) setUserPassword(user, String(body.newPassword));
    if (body.preferredTheme) user.preferredTheme = String(body.preferredTheme);
    if (body.accentColor) user.accentColor = String(body.accentColor);
    saveDatabase();
    return noContent(res);
  }

  return json(res, 404, { error: 'Users endpoint not found' });
}

function handleRoles(res, method, route, body) {
  if (method === 'GET' && route.length === 1) {
    return json(res, 200, db.roles.map(r => ({ roleId: r.roleId, roleName: r.roleName })));
  }

  if (method === 'POST' && route.length === 1) {
    const role = {
      roleId: nextId('roles', 'roleId'),
      roleName: String(body.roleName || '').trim()
    };
    db.roles.push(role);
    db.rolePermissions[String(role.roleId)] = Array.isArray(body.permissionCodes) ? body.permissionCodes : [];
    saveDatabase();
    return json(res, 200, { roleId: role.roleId });
  }

  if (method === 'GET' && route[1] === 'by-name' && route[3] === 'permissions') {
    const role = db.roles.find(item => same(item.roleName, route[2]));
    return json(res, 200, role ? rolePermissions(role) : defaultPermissions(route[2]));
  }

  const roleId = Number(route[1]);
  const role = db.roles.find(item => item.roleId === roleId);
  if (!role) return json(res, 404, { error: 'Role not found' });

  if (method === 'GET' && route[2] === 'permissions') {
    return json(res, 200, rolePermissions(role));
  }

  if (method === 'PUT' && route[2] === 'permissions') {
    db.rolePermissions[String(roleId)] = Array.isArray(body) ? body : [];
    saveDatabase();
    return noContent(res);
  }

  return json(res, 404, { error: 'Roles endpoint not found' });
}

function handleAdmin(res, method, route, body, user) {
  if (!isAdminUser(user)) {
    return json(res, 403, { error: 'Forbidden' });
  }

  if (method === 'GET' && route[1] === 'health') {
    const apiStarted = performance.now();
    const dbStarted = performance.now();
    let databaseElapsedMs = 0;
    try {
      fs.statSync(DB_FILE);
      databaseElapsedMs = performance.now() - dbStarted;
    } catch {
      databaseElapsedMs = performance.now() - dbStarted;
    }

    return json(res, 200, {
      ok: true,
      checkedAt: isoNow(),
      apiElapsedMs: roundMs(performance.now() - apiStarted),
      databaseElapsedMs: roundMs(databaseElapsedMs),
      tableCount: Object.keys(db).filter(key => Array.isArray(db[key])).length,
      totalRows: Object.keys(db).reduce((sum, key) => sum + (Array.isArray(db[key]) ? db[key].length : 0), 0)
    });
  }

  if (method === 'GET' && route[1] === 'export') {
    return json(res, 200, {
      version: 1,
      exportedAt: isoNow(),
      source: 'BrigadePlanner.MiniappJson',
      tables: db
    });
  }

  if (method === 'POST' && route[1] === 'import') {
    const importedTables = body && body.tables && typeof body.tables === 'object'
      ? body.tables
      : body;

    if (!importedTables || typeof importedTables !== 'object') {
      return json(res, 400, { error: 'Import JSON must contain database tables.' });
    }

    db = ensureDatabase({ ...importedTables });
    saveDatabase();
    return json(res, 200, {
      importedAt: isoNow(),
      tableCount: Object.keys(db).filter(key => Array.isArray(db[key])).length,
      rowCount: Object.keys(db).reduce((sum, key) => sum + (Array.isArray(db[key]) ? db[key].length : 0), 0)
    });
  }

  return json(res, 404, { error: 'Admin endpoint not found' });
}

function handleSites(res, method, route, body) {
  if (method === 'GET' && route.length === 1) {
    return json(res, 200, db.sites.filter(site => site.isActive !== false).map(siteDto));
  }

  if (method === 'POST' && route.length === 1) {
    const site = {
      siteId: nextId('sites', 'siteId'),
      siteCode: body.siteCode || null,
      siteName: body.siteName || '',
      address: body.address || null,
      isActive: true
    };
    db.sites.push(site);
    saveDatabase();
    return json(res, 200, { siteId: site.siteId });
  }

  const site = db.sites.find(item => item.siteId === Number(route[1]));
  if (!site) return json(res, 404, { error: 'Site not found' });

  if (method === 'PUT') {
    site.siteCode = body.siteCode || null;
    site.siteName = body.siteName || site.siteName;
    site.address = body.address || null;
    saveDatabase();
    return noContent(res);
  }

  if (method === 'DELETE') {
    site.isActive = false;
    saveDatabase();
    return noContent(res);
  }

  return json(res, 404, { error: 'Sites endpoint not found' });
}

function handleCrews(res, method, route, body) {
  if (method === 'GET' && route.length === 1) {
    return json(res, 200, db.crews.filter(c => c.isActive !== false).map(crewDto));
  }

  if (method === 'POST' && route.length === 1) {
    const externalId = normalizeExternalId(body.externalId);
    const existing = externalId
      ? db.crews.find(item => same(item.externalId, externalId))
      : db.crews.find(item =>
          same(item.crewName, body.crewName) &&
          Number(item.brigadierId || 0) === Number(body.brigadierId || 0));

    if (existing) {
      existing.crewName = body.crewName || existing.crewName;
      existing.brigadierId = body.brigadierId ? Number(body.brigadierId) : null;
      if (externalId) existing.externalId = externalId;
      existing.isActive = true;
      saveDatabase();
      return json(res, 200, { crewId: existing.crewId });
    }

    const crew = {
      crewId: nextId('crews', 'crewId'),
      crewName: body.crewName || '',
      brigadierId: body.brigadierId ? Number(body.brigadierId) : null,
      externalId,
      isActive: true
    };
    db.crews.push(crew);
    saveDatabase();
    return json(res, 200, { crewId: crew.crewId });
  }

  const crewId = Number(route[1]);
  const crew = db.crews.find(item => item.crewId === crewId);
  if (!crew) return json(res, 404, { error: 'Crew not found' });

  if (method === 'GET' && route[2] === 'members') {
    return json(res, 200, db.crewMembers.filter(m => m.crewId === crewId).map(crewMemberDto));
  }

  if (method === 'GET' && route[2] === 'available-users') {
    const activeIds = new Set(db.crewMembers.filter(m => m.crewId === crewId && !m.leftAt).map(m => m.userId));
    return json(res, 200, db.users.filter(u => u.isActive !== false && !activeIds.has(u.userId)).map(userDto));
  }

  if (method === 'POST' && route[2] === 'members' && route[4] === 'remove') {
    const member = db.crewMembers.find(m => m.crewId === crewId && m.userId === Number(route[3]) && !m.leftAt);
    if (member) member.leftAt = normalizeDate(body.leftAt || today());
    saveDatabase();
    return noContent(res);
  }

  if (method === 'POST' && route[2] === 'members' && route.length === 3) {
    db.crewMembers.push({
      crewId,
      userId: Number(body.userId),
      joinedAt: normalizeDate(body.joinedAt || today()),
      leftAt: null
    });
    saveDatabase();
    return noContent(res);
  }

  if (method === 'POST' && route[2] === 'employees') {
    const username = buildEmployeeLogin(body.fullName || 'employee');
    const user = {
      userId: nextId('users', 'userId'),
      username,
      fullName: body.fullName || username,
      roleId: 3,
      isActive: true,
      preferredTheme: 'Light',
      accentColor: 'Brown'
    };
    setUserPassword(user, username);
    db.users.push(user);
    db.crewMembers.push({ crewId, userId: user.userId, joinedAt: normalizeDate(body.joinedAt || today()), leftAt: null });
    saveDatabase();
    return json(res, 200, { userId: user.userId, username, password: username });
  }

  if (method === 'PUT' && route.length === 2) {
    crew.crewName = body.crewName || crew.crewName;
    crew.brigadierId = body.brigadierId ? Number(body.brigadierId) : null;
    const externalId = normalizeExternalId(body.externalId);
    if (externalId) crew.externalId = externalId;
    saveDatabase();
    return noContent(res);
  }

  if (method === 'DELETE' && route.length === 2) {
    crew.isActive = false;
    saveDatabase();
    return noContent(res);
  }

  return json(res, 404, { error: 'Crews endpoint not found' });
}

function handleTasks(res, method, route, body, query, user) {
  if (method === 'GET' && route.length === 1) {
    return json(res, 200, filteredTasks(query).map(taskDto));
  }

  if (method === 'POST' && route.length === 1) {
    const externalId = normalizeExternalId(body.externalId);
    const existing = externalId
      ? db.tasks.find(item => same(item.externalId, externalId))
      : null;

    if (existing) {
      applyTaskBody(existing, body);
      if (externalId) existing.externalId = externalId;
      saveDatabase();
      return json(res, 200, { taskId: existing.taskId });
    }

    const task = {
      taskId: nextId('tasks', 'taskId'),
      siteId: 0,
      crewId: null,
      title: '',
      description: null,
      startDate: today(),
      endDate: today(),
      priorityId: 2,
      taskStatusId: 1,
      labelId: null,
      externalId,
      publicCode: null,
      lastPrintedAt: null
    };
    applyTaskBody(task, body);
    task.publicCode = `T-${String(task.taskId).padStart(5, '0')}`;
    db.tasks.push(task);
    saveDatabase();
    return json(res, 200, { taskId: task.taskId });
  }

  const taskId = Number(route[1]);
  const task = db.tasks.find(item => item.taskId === taskId);
  if (!task) return json(res, 404, { error: 'Task not found' });

  if (method === 'GET' && route.length === 2) {
    return json(res, 200, taskDto(task));
  }

  if (method === 'PUT' && route.length === 2) {
    applyTaskBody(task, body);
    const externalId = normalizeExternalId(body.externalId);
    if (externalId) task.externalId = externalId;
    saveDatabase();
    return noContent(res);
  }

  if (method === 'DELETE' && route.length === 2) {
    db.tasks = db.tasks.filter(item => item.taskId !== taskId);
    saveDatabase();
    return noContent(res);
  }

  if (method === 'POST' && route[2] === 'duplicate') {
    const copy = { ...task, taskId: nextId('tasks', 'taskId'), title: `${task.title} (копия)` };
    copy.publicCode = `T-${String(copy.taskId).padStart(5, '0')}`;
    db.tasks.push(copy);
    saveDatabase();
    return json(res, 200, { taskId: copy.taskId });
  }

  if (method === 'POST' && route[2] === 'status') {
    changeTaskStatus(task, Number(body.statusId || body.taskStatusId || task.taskStatusId), body.comment, user);
    return noContent(res);
  }

  if (method === 'GET' && route[2] === 'reports') {
    return json(res, 200, db.taskReports.filter(r => r.taskId === taskId).map(taskReportDto));
  }

  if (method === 'POST' && route[2] === 'reports') {
    addTaskReport(taskId, Number(body.userId || user.userId), body.reportText || body.comment || '', body.progressPercent, body.attachmentUrl);
    return noContent(res);
  }

  if (method === 'GET' && route[2] === 'prints') {
    return json(res, 200, db.taskPrintLogs.filter(p => p.taskId === taskId).map(taskPrintDto));
  }

  if (method === 'POST' && route[2] === 'prints') {
    task.lastPrintedAt = body.printedAt || isoNow();
    db.taskPrintLogs.push({
      printLogId: nextId('taskPrintLogs', 'printLogId'),
      taskId,
      printedByUserId: Number(body.userId || user.userId),
      printedAt: task.lastPrintedAt,
      templateName: body.templateName || 'Наряд'
    });
    saveDatabase();
    return noContent(res);
  }

  return json(res, 404, { error: 'Tasks endpoint not found' });
}

function handleTaskReports(res, method, route, user) {
  if (method === 'GET' && route.length === 1) {
    return json(res, 200, db.taskReports.map(taskReportDto));
  }

  if (method === 'DELETE' && route.length === 2) {
    if (!isAdminUser(user)) {
      return json(res, 403, { error: 'Forbidden' });
    }

    const reportId = Number(route[1]);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      return json(res, 400, { error: 'Invalid task report id' });
    }

    const index = db.taskReports.findIndex(report => Number(report.reportId) === reportId);
    if (index < 0) {
      return json(res, 404, { error: 'Task report not found' });
    }

    db.taskReports.splice(index, 1);
    saveDatabase();
    return noContent(res);
  }

  return json(res, 404, { error: 'Task reports endpoint not found' });
}

function handleBrigadier(res, method, route, body, query, user) {
  if (method === 'GET' && route[1] === 'dashboard') {
    return json(res, 200, brigadierDashboard(user, query.get('date') || today()));
  }

  if (method === 'GET' && (route[1] === 'checklist' || (route[1] === 'tasks' && route[2] === 'today'))) {
    return json(res, 200, brigadierTasks(user, today()).map(taskDto));
  }

  if (method === 'GET' && route[1] === 'tasks' && route.length === 2) {
    return json(res, 200, brigadierTasks(user, query.get('date') || today()).map(taskDto));
  }

  if (method === 'GET' && route[1] === 'tasks' && route[2] === 'by-qr') {
    const task = brigadierTaskByPublicCode(user, route[3]);
    return task ? json(res, 200, taskDto(task)) : json(res, 404, { error: 'Task not found' });
  }

  if (method === 'GET' && route[1] === 'tasks' && route.length === 3) {
    const task = brigadierTaskById(user, Number(route[2]));
    return task ? json(res, 200, taskDto(task)) : json(res, 404, { error: 'Task not found' });
  }

  if (method === 'POST' && route[1] === 'tasks' && route[3] === 'status') {
    const task = brigadierTaskById(user, Number(route[2]));
    if (!task) return json(res, 404, { error: 'Task not found' });
    changeTaskStatus(task, Number(body.statusId || body.taskStatusId || task.taskStatusId), body.comment, user);
    return noContent(res);
  }

  if (method === 'POST' && route[1] === 'tasks' && route[3] === 'comment') {
    const task = brigadierTaskById(user, Number(route[2]));
    if (!task) return json(res, 404, { error: 'Task not found' });
    addTaskReport(task.taskId, user.userId, body.comment || '', null, null);
    return noContent(res);
  }

  if (method === 'POST' && route[1] === 'tasks' && route[3] === 'postpone') {
    const task = brigadierTaskById(user, Number(route[2]));
    if (!task) return json(res, 404, { error: 'Task not found' });
    const oldEndDate = task.endDate;
    task.endDate = normalizeDate(body.newEndDate || task.endDate);
    addTaskReport(task.taskId, user.userId, `Перенесена с ${oldEndDate} на ${task.endDate}. ${body.comment || ''}`, null, null, false);
    saveDatabase();
    return noContent(res);
  }

  if (method === 'GET' && route[1] === 'tasks' && route[3] === 'qr') {
    const task = brigadierTaskById(user, Number(route[2]));
    return task ? json(res, 200, { taskId: task.taskId, qrData: task.publicCode || `T-${task.taskId}` }) : json(res, 404, { error: 'Task not found' });
  }

  if (method === 'GET' && route[1] === 'calendar') {
    return json(res, 200, calendarDays(user, Number(query.get('year')), Number(query.get('month'))));
  }

  return json(res, 404, { error: 'Brigadier endpoint not found' });
}

function handleMaterials(res, method, route, query, body) {
  if (method === 'GET' && route[1] === 'catalog') {
    const activeOnly = String(query.get('activeOnly') || 'true').toLowerCase() !== 'false';
    const materials = activeOnly
      ? db.materialCatalog.filter(m => m.isActive !== false)
      : db.materialCatalog;
    return json(res, 200, materials.map(m => ({
      materialId: m.materialId,
      name: m.name,
      unit: m.unit,
      code: m.code,
      isActive: m.isActive !== false
    })));
  }

  if (method === 'POST' && route[1] === 'catalog') {
    const name = String(body?.name || '').trim();
    const unit = String(body?.unit || '').trim();
    const code = String(body?.code || '').trim() || null;

    if (!name || !unit) {
      return json(res, 400, { error: 'Material name and unit are required' });
    }

    const existing = db.materialCatalog.find(item =>
      same(item.name, name) &&
      same(item.unit, unit));

    if (existing) {
      existing.code = code || existing.code || null;
      existing.isActive = true;
      saveDatabase();
      return json(res, 200, { materialId: existing.materialId });
    }

    const material = {
      materialId: nextId('materialCatalog', 'materialId'),
      name,
      unit,
      code,
      isActive: true
    };
    db.materialCatalog.push(material);
    saveDatabase();
    return json(res, 200, { materialId: material.materialId });
  }

  return json(res, 404, { error: 'Materials endpoint not found' });
}

function handleMaterialRequests(res, method, route, body, user) {
  if (method === 'GET' && route.length === 1) {
    return json(res, 200, db.materialRequests.map(materialRequestDto));
  }

  if (method === 'POST' && route.length === 1) {
    const request = {
      requestId: nextId('materialRequests', 'requestId'),
      taskId: Number(body.taskId),
      createdByUserId: user.userId,
      createdAt: isoNow(),
      requiredDate: body.requiredDate ? normalizeDate(body.requiredDate) : null,
      status: 'Draft',
      comment: body.comment || null
    };
    db.materialRequests.push(request);
    replaceMaterialRequestItems(request.requestId, body.items || []);
    saveDatabase();
    return json(res, 200, { requestId: request.requestId });
  }

  const request = db.materialRequests.find(item => item.requestId === Number(route[1]));
  if (!request) return json(res, 404, { error: 'Material request not found' });

  if (method === 'GET' && route.length === 2) {
    return json(res, 200, materialRequestDto(request));
  }

  if (method === 'PUT' && route.length === 2) {
    request.requiredDate = body.requiredDate ? normalizeDate(body.requiredDate) : null;
    request.comment = body.comment || null;
    replaceMaterialRequestItems(request.requestId, body.items || []);
    saveDatabase();
    return noContent(res);
  }

  if (method === 'POST' && (route[2] === 'status' || ['submit', 'approve', 'reject', 'issue', 'deliver', 'close'].includes(route[2]))) {
    const status = body.status || actionStatus(route[2]);
    changeMaterialRequestStatus(request, status, body.comment, body.documentNumber, user);
    return noContent(res);
  }

  if (method === 'POST' && route[2] === 'delivery-docs') {
    db.materialDeliveryDocs.push({
      deliveryDocId: nextId('materialDeliveryDocs', 'deliveryDocId'),
      requestId: request.requestId,
      eventType: body.eventType || 'Document',
      docNumber: body.docNumber || null,
      note: body.note || null,
      eventAt: isoNow()
    });
    saveDatabase();
    return noContent(res);
  }

  return json(res, 404, { error: 'Material requests endpoint not found' });
}

function handleDailyPlan(res, method, route, body, query) {
  if (method === 'GET' && route.length === 1) {
    const date = normalizeDate(query.get('date') || today());
    const plan = db.dailyPlans.find(item => item.planDate === date);
    return plan ? json(res, 200, dailyPlanDto(plan)) : json(res, 404, { error: 'Daily plan not found' });
  }

  if (method === 'POST' && route.length === 1) {
    const date = normalizeDate(body.planDate || today());
    let plan = body.planId ? db.dailyPlans.find(item => item.planId === Number(body.planId)) : null;
    if (!plan) {
      plan = db.dailyPlans.find(item => item.planDate === date);
    }
    if (!plan) {
      plan = {
        planId: nextId('dailyPlans', 'planId'),
        planDate: date,
        createdByUserId: Number(body.userId || 1),
        createdAt: isoNow(),
        comment: body.comment || null,
        status: 'Черновик'
      };
      db.dailyPlans.push(plan);
    } else {
      plan.comment = body.comment || null;
    }

    db.dailyPlanItems = db.dailyPlanItems.filter(item => item.planId !== plan.planId);
    for (const item of body.items || []) {
      db.dailyPlanItems.push({
        planItemId: nextId('dailyPlanItems', 'planItemId'),
        planId: plan.planId,
        taskId: Number(item.taskId),
        crewId: Number(item.crewId),
        sortOrder: Number(item.sortOrder || 0),
        note: item.note || null,
        materialsReady: Boolean(item.materialsReady)
      });
    }
    saveDatabase();
    return json(res, 200, { planId: plan.planId });
  }

  if (method === 'POST' && route[2] === 'approve') {
    const plan = db.dailyPlans.find(item => item.planId === Number(route[1]));
    if (plan) plan.status = 'Утвержден';
    saveDatabase();
    return noContent(res);
  }

  if (method === 'GET' && route[1] === 'approved-items') {
    const date = normalizeDate(query.get('date') || today());
    const planIds = db.dailyPlans.filter(item => item.planDate === date && item.status === 'Утвержден').map(item => item.planId);
    return json(res, 200, db.dailyPlanItems.filter(item => planIds.includes(item.planId)).map(dailyPlanItemDto));
  }

  return json(res, 404, { error: 'Daily plan endpoint not found' });
}

function handleReports(res, method, route) {
  if (method !== 'GET') return json(res, 404, { error: 'Reports endpoint not found' });
  if (route[1] === 'tasks') return json(res, 200, db.tasks.map(taskDto));
  if (route[1] === 'overdue') return json(res, 200, db.tasks.filter(isOverdue).map(taskDto));
  if (route[1] === 'by-sites') return json(res, 200, summaryBy(db.tasks, task => joinSite(task.siteId)?.siteName || 'Не указан'));
  if (route[1] === 'by-crews') return json(res, 200, summaryBy(db.tasks, task => joinCrew(task.crewId)?.crewName || 'Не назначена'));
  if (route[1] === 'by-priorities') return json(res, 200, summaryBy(db.tasks, task => joinPriority(task.priorityId)?.priorityName || 'Не указан'));
  if (route[1] === 'material-requests') return json(res, 200, db.materialRequests.map(materialRequestDto));
  return json(res, 404, { error: 'Reports endpoint not found' });
}

function filteredTasks(query) {
  let tasks = [...db.tasks];
  const siteId = Number(query.get('siteId') || 0);
  const crewId = Number(query.get('crewId') || 0);
  const statusId = Number(query.get('statusId') || 0);
  const priorityId = Number(query.get('priorityId') || 0);
  const search = String(query.get('search') || '').trim().toLowerCase();
  if (siteId) tasks = tasks.filter(t => t.siteId === siteId);
  if (crewId) tasks = tasks.filter(t => t.crewId === crewId);
  if (statusId) tasks = tasks.filter(t => t.taskStatusId === statusId);
  if (priorityId) tasks = tasks.filter(t => t.priorityId === priorityId);
  if (search) tasks = tasks.filter(t => [t.title, t.description].some(value => String(value || '').toLowerCase().includes(search)));
  return tasks.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.taskId - b.taskId);
}

function brigadierTasks(user, date) {
  const normalized = normalizeDate(date);
  const crewIds = new Set(brigadierCrewIds(user));
  if (crewIds.size === 0) {
    return [];
  }

  const source = db.tasks.filter(t => crewIds.has(t.crewId));
  return source.filter(task => task.startDate <= normalized && task.endDate >= normalized);
}

function brigadierTaskById(user, taskId) {
  const crewIds = new Set(brigadierCrewIds(user));
  const task = indexes.tasksById.get(Number(taskId));
  return task && crewIds.has(task.crewId) ? task : null;
}

function brigadierTaskByPublicCode(user, publicCode) {
  const crewIds = new Set(brigadierCrewIds(user));
  return db.tasks.find(task => same(task.publicCode, publicCode) && crewIds.has(task.crewId));
}

function brigadierCrewIds(user) {
  const ids = new Set();
  for (const crew of indexes.crewsByBrigadierId.get(Number(user.userId)) || []) {
    if (crew.isActive !== false) ids.add(crew.crewId);
  }

  for (const member of indexes.crewMembersByUserId.get(Number(user.userId)) || []) {
    if (!member.leftAt) {
      const crew = joinCrew(member.crewId);
      if (crew) ids.add(crew.crewId);
    }
  }

  return Array.from(ids);
}

function applyTaskBody(task, body) {
  task.siteId = Number(body.siteId || task.siteId);
  task.crewId = body.crewId ? Number(body.crewId) : null;
  task.title = body.title || task.title;
  task.description = body.description || null;
  task.startDate = normalizeDate(body.startDate || task.startDate || today());
  task.endDate = normalizeDate(body.endDate || task.endDate || today());
  task.priorityId = Number(body.priorityId || task.priorityId || 2);
  task.taskStatusId = Number(body.taskStatusId || body.statusId || task.taskStatusId || 1);
  task.labelId = body.labelId || task.labelId || null;
}

function brigadierDashboard(user, date) {
  const normalized = normalizeDate(date);
  const tasks = brigadierTasks(user, normalized);
  const crewIds = brigadierCrewIds(user);
  const crew = crewIds.length > 0 ? joinCrew(crewIds[0]) : null;
  return {
    fullName: user.fullName,
    crewName: crew?.crewName || null,
    today: normalized,
    todayTotal: tasks.length,
    todayCompleted: tasks.filter(t => joinStatus(t.taskStatusId)?.taskStatusName === 'Завершено').length,
    todayInProgress: tasks.filter(t => joinStatus(t.taskStatusId)?.taskStatusName === 'В работе').length,
    todayOverdue: tasks.filter(isOverdue).length
  };
}

function calendarDays(user, year, month) {
  const y = year || new Date().getFullYear();
  const m = month || (new Date().getMonth() + 1);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  const crewIds = new Set(brigadierCrewIds(user));
  const tasks = db.tasks.filter(task =>
    crewIds.has(task.crewId) &&
    task.startDate <= endDate &&
    task.endDate >= startDate);
  const result = [];

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    const dayTasks = tasks.filter(task => task.startDate <= date && task.endDate >= date);
    if (dayTasks.length > 0) {
      result.push({ date, taskCount: dayTasks.length, hasOverdue: dayTasks.some(isOverdue) });
    }
  }

  return result;
}

function changeTaskStatus(task, statusId, comment, user) {
  const oldStatus = joinStatus(task.taskStatusId)?.taskStatusName || '';
  task.taskStatusId = statusId;
  const newStatus = joinStatus(statusId)?.taskStatusName || '';
  addTaskReport(task.taskId, user.userId, comment || `Статус изменен: ${oldStatus} -> ${newStatus}`, null, null, false);
  saveDatabase();
}

function addTaskReport(taskId, userId, text, progressPercent, attachmentUrl, shouldSave = true) {
  db.taskReports.push({
    reportId: nextId('taskReports', 'reportId'),
    taskId,
    reportedByUserId: userId,
    reportedAt: isoNow(),
    reportText: text || '',
    progressPercent: progressPercent == null ? null : Number(progressPercent),
    attachmentUrl: attachmentUrl || null
  });
  if (shouldSave) saveDatabase();
}

function uploadAttachment(res, body) {
  const originalName = sanitizeAttachmentFileName(body.fileName);
  const contentBase64 = String(body.contentBase64 || '');
  if (!originalName || !contentBase64) {
    return json(res, 400, { error: 'fileName and contentBase64 are required' });
  }

  let content;
  try {
    content = Buffer.from(contentBase64, 'base64');
  } catch {
    return json(res, 400, { error: 'Invalid attachment content' });
  }

  if (!content.length) {
    return json(res, 400, { error: 'Attachment is empty' });
  }

  fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
  const storedName = `${crypto.randomBytes(16).toString('hex')}_${originalName}`;
  fs.writeFileSync(path.join(ATTACHMENTS_DIR, storedName), content);
  return json(res, 200, { attachmentUrl: `/api/attachments/${encodeURIComponent(storedName)}` });
}

function serveAttachment(res, fileName) {
  const safeName = path.basename(String(fileName || ''));
  if (!safeName) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const filePath = path.resolve(path.join(ATTACHMENTS_DIR, safeName));
  const rootPath = path.resolve(ATTACHMENTS_DIR);
  if (!filePath.startsWith(rootPath + path.sep) && filePath !== rootPath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': attachmentMimeType(path.extname(filePath)),
      'Cache-Control': 'public, max-age=31536000'
    });
    res.end(content);
  });
}

function sanitizeAttachmentFileName(fileName) {
  const rawName = path.basename(String(fileName || '').trim());
  if (!rawName) return null;
  return rawName
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120);
}

function attachmentMimeType(extension) {
  switch (String(extension || '').toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.bmp':
      return 'image/bmp';
    case '.gif':
      return 'image/gif';
    case '.pdf':
      return 'application/pdf';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.csv':
      return 'text/csv; charset=utf-8';
    case '.tsv':
      return 'text/tab-separated-values; charset=utf-8';
    case '.doc':
      return 'application/msword';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.xls':
      return 'application/vnd.ms-excel';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    default:
      return 'application/octet-stream';
  }
}

function replaceMaterialRequestItems(requestId, items) {
  db.materialRequestItems = db.materialRequestItems.filter(item => item.requestId !== requestId);
  for (const item of items) {
    db.materialRequestItems.push({
      requestItemId: nextId('materialRequestItems', 'requestItemId'),
      requestId,
      materialId: Number(item.materialId),
      qty: Number(item.qty || item.quantity || 0),
      comment: item.comment || null
    });
  }
}

function changeMaterialRequestStatus(request, newStatus, comment, documentNumber, user) {
  const oldStatus = request.status;
  request.status = newStatus || request.status;
  db.materialRequestStatusLog.push({
    statusLogId: nextId('materialRequestStatusLog', 'statusLogId'),
    requestId: request.requestId,
    oldStatus,
    newStatus: request.status,
    changedByUserId: user.userId,
    changedAt: isoNow(),
    comment: comment || null,
    documentNumber: documentNumber || null
  });
  saveDatabase();
}

function dashboardDto() {
  return {
    totalTasks: db.tasks.length,
    completedTasks: db.tasks.filter(t => joinStatus(t.taskStatusId)?.taskStatusName === 'Завершено').length,
    overdueTasks: db.tasks.filter(isOverdue).length,
    activeCrews: db.crews.filter(c => c.isActive !== false).length,
    materialRequests: db.materialRequests.length
  };
}

function summaryBy(tasks, keySelector) {
  const groups = new Map();
  for (const task of tasks) {
    const key = keySelector(task);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }

  return Array.from(groups.entries()).map(([name, items]) => ({
    name,
    total: items.length,
    completed: items.filter(t => joinStatus(t.taskStatusId)?.taskStatusName === 'Завершено').length,
    overdue: items.filter(isOverdue).length
  }));
}

function taskDto(task) {
  const site = joinSite(task.siteId);
  const crew = joinCrew(task.crewId);
  const brigadier = crew ? joinUser(crew.brigadierId) : null;
  const priority = joinPriority(task.priorityId);
  const status = joinStatus(task.taskStatusId);
  return {
    taskId: task.taskId,
    siteId: task.siteId,
    crewId: task.crewId,
    title: task.title,
    description: task.description,
    startDate: task.startDate,
    endDate: task.endDate,
    priorityId: task.priorityId,
    taskStatusId: task.taskStatusId,
    labelId: task.labelId || null,
    lastPrintedAt: task.lastPrintedAt || null,
    siteName: site?.siteName || null,
    siteAddress: site?.address || null,
    crewName: crew?.crewName || null,
    brigadierId: crew?.brigadierId || null,
    brigadierName: brigadier?.fullName || null,
    priorityName: priority?.priorityName || null,
    taskStatusName: status?.taskStatusName || null,
    externalId: task.externalId || null
  };
}

function userDto(user) {
  const role = joinRole(user.roleId);
  return {
    userId: user.userId,
    roleId: user.roleId,
    username: user.username,
    fullName: user.fullName,
    role: role?.roleName || null,
    preferredTheme: user.preferredTheme || 'Light',
    accentColor: user.accentColor || 'Brown'
  };
}

function siteDto(site) {
  return {
    siteId: site.siteId,
    siteCode: site.siteCode,
    siteName: site.siteName,
    address: site.address
  };
}

function crewDto(crew) {
  const brigadier = joinUser(crew.brigadierId);
  return {
    crewId: crew.crewId,
    crewName: crew.crewName,
    brigadierId: crew.brigadierId,
    brigadierName: brigadier?.fullName || null,
    externalId: crew.externalId || null
  };
}

function normalizeExternalId(value) {
  const text = String(value || '').trim();
  return text || null;
}

function crewMemberDto(member) {
  const user = joinUser(member.userId);
  return {
    crewId: member.crewId,
    userId: member.userId,
    joinedAt: member.joinedAt,
    leftAt: member.leftAt || null,
    username: user?.username || null,
    fullName: user?.fullName || null
  };
}

function taskReportDto(report) {
  const task = indexes.tasksById.get(Number(report.taskId));
  const user = joinUser(report.reportedByUserId);
  return {
    reportId: report.reportId,
    taskId: report.taskId,
    reportedByUserId: report.reportedByUserId,
    reportedAt: report.reportedAt,
    reportText: report.reportText,
    progressPercent: report.progressPercent,
    attachmentUrl: report.attachmentUrl,
    taskTitle: task?.title || null,
    reporterName: user?.fullName || null
  };
}

function taskPrintDto(print) {
  const user = joinUser(print.printedByUserId);
  return {
    printLogId: print.printLogId,
    taskId: print.taskId,
    printedByUserId: print.printedByUserId,
    printedAt: print.printedAt,
    templateName: print.templateName,
    printedByName: user?.fullName || null
  };
}

function materialRequestDto(request) {
  const task = indexes.tasksById.get(Number(request.taskId));
  const site = task ? joinSite(task.siteId) : null;
  const crew = task ? joinCrew(task.crewId) : null;
  return {
    requestId: request.requestId,
    taskId: request.taskId,
    createdByUserId: request.createdByUserId,
    createdAt: request.createdAt,
    requiredDate: request.requiredDate,
    status: request.status,
    comment: request.comment,
    taskTitle: task?.title || null,
    siteId: task?.siteId || null,
    siteName: site?.siteName || null,
    crewId: task?.crewId || null,
    crewName: crew?.crewName || null,
    items: (indexes.materialItemsByRequestId.get(Number(request.requestId)) || []).map(materialRequestItemDto)
  };
}

function materialRequestItemDto(item) {
  const material = indexes.materialById.get(Number(item.materialId));
  return {
    requestItemId: item.requestItemId,
    requestId: item.requestId,
    materialId: item.materialId,
    qty: item.qty,
    comment: item.comment,
    materialName: material?.name || null,
    unit: material?.unit || null
  };
}

function dailyPlanDto(plan) {
  return {
    planId: plan.planId,
    planDate: plan.planDate,
    createdByUserId: plan.createdByUserId,
    createdAt: plan.createdAt,
    comment: plan.comment,
    status: plan.status,
    items: (indexes.dailyItemsByPlanId.get(Number(plan.planId)) || []).map(dailyPlanItemDto)
  };
}

function dailyPlanItemDto(item) {
  const task = indexes.tasksById.get(Number(item.taskId));
  const crew = joinCrew(item.crewId);
  const site = task ? joinSite(task.siteId) : null;
  return {
    planItemId: item.planItemId,
    planId: item.planId,
    taskId: item.taskId,
    crewId: item.crewId,
    sortOrder: item.sortOrder,
    note: item.note,
    materialsReady: Boolean(item.materialsReady),
    taskTitle: task?.title || null,
    crewName: crew?.crewName || null,
    siteName: site?.siteName || null
  };
}

function rolePermissions(role) {
  const configured = db.rolePermissions[String(role.roleId)];
  return configured && configured.length > 0 ? configured : defaultPermissions(role.roleName);
}

function defaultPermissions(roleName) {
  const name = String(roleName || '').trim().toLowerCase();
  if (['администратор', 'админ', 'admin', 'administrator'].includes(name)) return allPermissions;
  if (['диспетчер', 'dispatcher'].includes(name)) {
    return [
      permissions.dashboardView,
      permissions.sitesView,
      permissions.sitesManage,
      permissions.crewsView,
      permissions.crewsManage,
      permissions.crewMembersManage,
      permissions.tasksView,
      permissions.tasksManage,
      permissions.tasksDuplicate,
      permissions.calendarView,
      permissions.reportsView,
      permissions.reportsExport,
      permissions.materialRequestsView,
      permissions.materialRequestsManage,
      permissions.dailyPlanView
    ];
  }
  if (['бригадир', 'foreman'].includes(name)) {
    return [permissions.tasksView, permissions.calendarView, permissions.dailyPlanView];
  }
  return [];
}

function isAdminUser(user) {
  if (!user) return false;
  if (String(user.username || '').trim().toLowerCase() === 'maksim') return true;
  const roleName = joinRole(user.roleId)?.roleName || user.role || '';
  return ['администратор', 'админ', 'admin', 'administrator'].includes(String(roleName).trim().toLowerCase());
}

function roundMs(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function loadDatabase() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let loaded = null;
  if (fs.existsSync(DB_FILE)) {
    loaded = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  }

  const database = ensureDatabase(loaded || seedDatabase());
  saveDatabase(database);
  return database;
}

function saveDatabase(database = db) {
  if (isDatabaseInitialized && database === db && indexes) {
    indexes = buildIndexes(database);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(database), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

function buildIndexes(database) {
  const index = {
    rolesById: new Map(),
    usersById: new Map(),
    sitesById: new Map(),
    crewsById: new Map(),
    crewsByBrigadierId: new Map(),
    prioritiesById: new Map(),
    statusesById: new Map(),
    tasksById: new Map(),
    materialById: new Map(),
    crewMembersByUserId: new Map(),
    materialItemsByRequestId: new Map(),
    dailyItemsByPlanId: new Map()
  };

  for (const role of database.roles || []) index.rolesById.set(Number(role.roleId), role);
  for (const user of database.users || []) index.usersById.set(Number(user.userId), user);
  for (const site of database.sites || []) index.sitesById.set(Number(site.siteId), site);
  for (const crew of database.crews || []) {
    index.crewsById.set(Number(crew.crewId), crew);
    addIndexed(index.crewsByBrigadierId, Number(crew.brigadierId), crew);
  }
  for (const priority of database.priorities || []) index.prioritiesById.set(Number(priority.priorityId), priority);
  for (const status of database.taskStatuses || []) index.statusesById.set(Number(status.taskStatusId), status);
  for (const task of database.tasks || []) index.tasksById.set(Number(task.taskId), task);
  for (const material of database.materialCatalog || []) index.materialById.set(Number(material.materialId), material);
  for (const member of database.crewMembers || []) addIndexed(index.crewMembersByUserId, Number(member.userId), member);
  for (const item of database.materialRequestItems || []) addIndexed(index.materialItemsByRequestId, Number(item.requestId), item);
  for (const item of database.dailyPlanItems || []) addIndexed(index.dailyItemsByPlanId, Number(item.planId), item);

  return index;
}

function addIndexed(map, key, value) {
  if (!Number.isFinite(key)) return;
  const values = map.get(key);
  if (values) {
    values.push(value);
  } else {
    map.set(key, [value]);
  }
}

function ensureDatabase(database) {
  const seeded = seedDatabase();
  for (const key of Object.keys(seeded)) {
    if (Array.isArray(seeded[key]) && !Array.isArray(database[key])) database[key] = seeded[key];
    if (key === 'rolePermissions' && !database[key]) database[key] = seeded[key];
    if (key === 'counters' && !database[key]) database[key] = {};
  }

  ensureStarterRows(database, seeded);
  rebuildCounters(database);
  return database;
}

function seedDatabase() {
  const date = today();
  const admin = userSeed(1, '1', '1', 'Администратор', 1);
  const dispatcher = userSeed(2, '2', '2', 'Диспетчер', 2);
  const brigadier = userSeed(3, '3', '3', 'Бригадир 1', 3);
  const brigadier2 = userSeed(5, 'brigadir2', 'brigadir2', 'Бригадир 2', 3);
  const brigadier3 = userSeed(6, 'brigadir3', 'brigadir3', 'Бригадир 3', 3);
  const demo = buildFullDemoSeed(date);

  return {
    counters: {},
    roles: [
      { roleId: 1, roleName: 'Администратор' },
      { roleId: 2, roleName: 'Диспетчер' },
      { roleId: 3, roleName: 'Бригадир' }
    ],
    rolePermissions: {},
    users: [admin, dispatcher, brigadier, brigadier2, brigadier3],
    sites: demo.sites,
    crews: demo.crews,
    crewMembers: demo.crewMembers,
    priorities: demo.priorities,
    taskStatuses: demo.taskStatuses,
    tasks: demo.tasks,
    taskReports: demo.taskReports,
    taskPrintLogs: [],
    materialCatalog: demo.materialCatalog,
    materialRequests: demo.materialRequests,
    materialRequestItems: demo.materialRequestItems,
    materialRequestStatusLog: [],
    materialDeliveryDocs: demo.materialDeliveryDocs,
    dailyPlans: demo.dailyPlans,
    dailyPlanItems: demo.dailyPlanItems
  };
}

function buildFullDemoSeed(date) {
  const sites = [
    { siteId: 1, siteCode: 'SEV-01', siteName: 'Северный квартал', address: 'г. Москва, ул. Северная, 10', isActive: true },
    { siteId: 2, siteCode: 'ZAP-02', siteName: 'Западный мост', address: 'г. Москва, пр-т Западный, 25', isActive: true },
    { siteId: 3, siteCode: 'CENT-03', siteName: 'Центральный корпус', address: 'г. Москва, ул. Центральная, 7', isActive: true },
    { siteId: 4, siteCode: 'SKL-04', siteName: 'Складской терминал', address: 'г. Химки, Транспортный проезд, 4', isActive: true }
  ];

  const crews = [
    { crewId: 1, crewName: 'Монолитная бригада', brigadierId: 3, externalId: 'seed:crew:monolith', isActive: true },
    { crewId: 2, crewName: 'Отделочная бригада', brigadierId: 5, externalId: 'seed:crew:finish', isActive: true },
    { crewId: 3, crewName: 'Инженерная бригада', brigadierId: 6, externalId: 'seed:crew:engineering', isActive: true }
  ];

  const crewMembers = [
    { crewId: 1, userId: 3, joinedAt: addDays(date, -30), leftAt: null },
    { crewId: 2, userId: 5, joinedAt: addDays(date, -24), leftAt: null },
    { crewId: 3, userId: 6, joinedAt: addDays(date, -20), leftAt: null }
  ];

  const priorities = [
    { priorityId: 1, priorityName: 'Низкий', sortOrder: 1 },
    { priorityId: 2, priorityName: 'Средний', sortOrder: 2 },
    { priorityId: 3, priorityName: 'Высокий', sortOrder: 3 },
    { priorityId: 4, priorityName: 'Критичный', sortOrder: 4 }
  ];

  const taskStatuses = [
    { taskStatusId: 1, taskStatusName: 'Новая' },
    { taskStatusId: 2, taskStatusName: 'В работе' },
    { taskStatusId: 3, taskStatusName: 'Завершено' },
    { taskStatusId: 4, taskStatusName: 'Просрочено' }
  ];

  const materialCatalog = [
    { materialId: 1, name: 'Бетон B25', unit: 'м3', code: 'BET-B25', isActive: true },
    { materialId: 2, name: 'Арматура A500', unit: 'т', code: 'ARM-A500', isActive: true },
    { materialId: 3, name: 'Опалубка', unit: 'компл.', code: 'OPL', isActive: true },
    { materialId: 4, name: 'Кирпич керамический', unit: 'шт.', code: 'KIR-KER', isActive: true },
    { materialId: 5, name: 'Раствор кладочный М100', unit: 'м3', code: 'RST-M100', isActive: true },
    { materialId: 6, name: 'Грунтовка глубокого проникновения', unit: 'л', code: 'GRU-GP', isActive: true },
    { materialId: 7, name: 'Гипсовая штукатурка', unit: 'меш.', code: 'SHT-GIP', isActive: true },
    { materialId: 8, name: 'Плитка керамогранит', unit: 'м2', code: 'PLT-KER', isActive: true },
    { materialId: 9, name: 'Кабель ВВГнг-LS', unit: 'м', code: 'KBL-VVG', isActive: true },
    { materialId: 10, name: 'Труба ПНД 32', unit: 'м', code: 'TRB-PND32', isActive: true },
    { materialId: 11, name: 'Воздуховод оцинкованный', unit: 'м', code: 'VENT-ZN', isActive: true },
    { materialId: 12, name: 'Мембрана кровельная', unit: 'м2', code: 'MEM-KROV', isActive: true },
    { materialId: 13, name: 'Бетон B20', unit: 'м3', code: 'BET-B20', isActive: true },
    { materialId: 14, name: 'Бетон B30', unit: 'м3', code: 'BET-B30', isActive: true },
    { materialId: 15, name: 'Песок строительный', unit: 'м3', code: 'SAND', isActive: true },
    { materialId: 16, name: 'Щебень фракция 20-40', unit: 'м3', code: 'SCH-2040', isActive: true },
    { materialId: 17, name: 'Цемент М500', unit: 'меш.', code: 'CEM-M500', isActive: true },
    { materialId: 18, name: 'Проволока вязальная', unit: 'кг', code: 'WIRE-KNIT', isActive: true },
    { materialId: 19, name: 'Фиксатор арматуры', unit: 'шт.', code: 'FIX-ARM', isActive: true },
    { materialId: 20, name: 'Блок газобетонный', unit: 'шт.', code: 'GBLOCK', isActive: true },
    { materialId: 21, name: 'Шпатлевка финишная', unit: 'меш.', code: 'SHP-FIN', isActive: true },
    { materialId: 22, name: 'Краска водно-дисперсионная', unit: 'л', code: 'PAINT-VD', isActive: true },
    { materialId: 23, name: 'Клей плиточный', unit: 'меш.', code: 'GLUE-PLT', isActive: true },
    { materialId: 24, name: 'Гидроизоляционная мастика', unit: 'кг', code: 'HYD-MAST', isActive: true },
    { materialId: 25, name: 'Утеплитель минераловатный', unit: 'м2', code: 'INS-MW', isActive: true },
    { materialId: 26, name: 'Гипсокартон', unit: 'лист', code: 'GKL', isActive: true },
    { materialId: 27, name: 'Профиль металлический', unit: 'м', code: 'PROF-MET', isActive: true },
    { materialId: 28, name: 'Саморезы', unit: 'упак.', code: 'SCREW', isActive: true },
    { materialId: 29, name: 'Дюбель-гвоздь', unit: 'упак.', code: 'DOWEL', isActive: true },
    { materialId: 30, name: 'Гофротруба', unit: 'м', code: 'GOFRA', isActive: true },
    { materialId: 31, name: 'Автоматический выключатель', unit: 'шт.', code: 'AUT-SW', isActive: true },
    { materialId: 32, name: 'Розетка', unit: 'шт.', code: 'SOCKET', isActive: true },
    { materialId: 33, name: 'Светильник', unit: 'шт.', code: 'LIGHT', isActive: true },
    { materialId: 34, name: 'Труба ПВХ канализационная', unit: 'м', code: 'TRB-PVC', isActive: true },
    { materialId: 35, name: 'Фитинги сантехнические', unit: 'компл.', code: 'FIT-SAN', isActive: true },
    { materialId: 36, name: 'Клапан вентиляционный', unit: 'шт.', code: 'VENT-KL', isActive: true },
    { materialId: 37, name: 'Дверной блок', unit: 'шт.', code: 'DOOR-BLK', isActive: true },
    { materialId: 38, name: 'Оконный блок', unit: 'шт.', code: 'WIN-BLK', isActive: true },
    { materialId: 39, name: 'Пена монтажная', unit: 'балл.', code: 'FOAM', isActive: true },
    { materialId: 40, name: 'Герметик силиконовый', unit: 'туб.', code: 'SEAL-SIL', isActive: true }
  ];

  const tasks = [
    taskSeed(date, 1, 1, 1, 'Разметка осей секции А', 'Вынести проектные оси, закрепить реперы и оформить исполнительную схему.', -1, 1, 3, 2),
    taskSeed(date, 2, 1, 1, 'Армирование плиты перекрытия', 'Собрать нижнюю и верхнюю сетку, проверить защитный слой и выпуски.', 0, 4, 4, 2),
    taskSeed(date, 3, 1, 1, 'Заливка бетона под колонны', 'Подготовить карту бетонирования, принять бетон B25 и выполнить виброуплотнение.', 1, 5, 4, 1),
    taskSeed(date, 4, 1, 2, 'Монтаж опалубки лестничного марша', 'Собрать щиты, выставить подпорки, проверить геометрию перед армированием.', -2, 2, 3, 2),
    taskSeed(date, 5, 2, 1, 'Гидроизоляция фундамента', 'Очистить поверхность, нанести праймер и два слоя рулонной гидроизоляции.', -3, -1, 3, 4),
    taskSeed(date, 6, 3, 2, 'Кладка перегородок 2 этажа', 'Выполнить кладку межкомнатных перегородок с перевязкой и армированием рядов.', 0, 6, 3, 2),
    taskSeed(date, 7, 3, 2, 'Штукатурка мест общего пользования', 'Подготовить основания, выставить маяки и выполнить машинное нанесение.', 2, 8, 2, 1),
    taskSeed(date, 8, 3, 2, 'Монтаж оконных блоков', 'Проверить проемы, установить рамы, выполнить крепление и герметизацию узлов.', -4, -1, 2, 3),
    taskSeed(date, 9, 3, 2, 'Стяжка пола секция Б', 'Подготовить основание, разложить демпферную ленту и залить стяжку.', -1, 3, 3, 2),
    taskSeed(date, 10, 3, 2, 'Укладка плитки входной группы', 'Разметить рисунок, уложить керамогранит и выполнить затирку швов.', 4, 10, 2, 1),
    taskSeed(date, 11, 4, 3, 'Прокладка кабельных трасс', 'Разметить трассы, смонтировать лотки и протянуть кабельные линии.', -1, 5, 3, 2),
    taskSeed(date, 12, 4, 3, 'Монтаж щита освещения', 'Установить щит, собрать автоматы, подписать группы и выполнить прозвонку.', 1, 3, 3, 1),
    taskSeed(date, 13, 4, 3, 'Сборка вентиляционного короба', 'Смонтировать оцинкованные секции, выполнить подвесы и проверить герметичность.', 0, 4, 2, 2),
    taskSeed(date, 14, 4, 3, 'Пусконаладка насосной станции', 'Проверить подключение, выполнить пробный пуск и замер рабочих параметров.', 5, 7, 4, 1),
    taskSeed(date, 15, 4, 3, 'Проверка пожарной сигнализации', 'Протестировать шлейфы, датчики и передачу сигнала на пост охраны.', -2, 0, 4, 2),
    taskSeed(date, 16, 2, 1, 'Подготовка кровли к мембране', 'Очистить основание, проверить уклоны и подготовить примыкания.', -5, -2, 2, 4),
    taskSeed(date, 17, 2, 1, 'Монтаж водосточной системы', 'Установить кронштейны, желоба и воронки с проверкой уклонов.', 2, 6, 2, 1),
    taskSeed(date, 18, 1, 1, 'Приемка поставки арматуры', 'Сверить сертификаты, объемы поставки и разместить арматуру по картам.', 0, 0, 3, 2),
    taskSeed(date, 19, 2, 2, 'Устранение замечаний технадзора', 'Закрыть замечания по отделочным работам и приложить фотофиксацию.', -6, -3, 3, 3),
    taskSeed(date, 20, 4, 3, 'Финальная уборка зоны работ', 'Очистить рабочую зону, вывезти мусор и подготовить участок к приемке.', 6, 8, 1, 1)
  ];

  const taskReports = [
    { reportId: 1, taskId: 1, reportedByUserId: 3, reportedAt: isoNow(), reportText: 'Разметка начата, реперы закреплены.', progressPercent: 35, attachmentUrl: null },
    { reportId: 2, taskId: 2, reportedByUserId: 3, reportedAt: isoNow(), reportText: 'Нижняя сетка собрана, требуется довоз фиксаторов.', progressPercent: 45, attachmentUrl: null },
    { reportId: 3, taskId: 6, reportedByUserId: 5, reportedAt: isoNow(), reportText: 'Перегородки по оси 2-4 выполнены до отметки 1.8 м.', progressPercent: 40, attachmentUrl: null },
    { reportId: 4, taskId: 11, reportedByUserId: 6, reportedAt: isoNow(), reportText: 'Лотки смонтированы в коридоре, продолжаем протяжку кабеля.', progressPercent: 55, attachmentUrl: null },
    { reportId: 5, taskId: 8, reportedByUserId: 5, reportedAt: isoNow(), reportText: 'Оконные блоки установлены и приняты мастером участка.', progressPercent: 100, attachmentUrl: null },
    { reportId: 6, taskId: 19, reportedByUserId: 5, reportedAt: isoNow(), reportText: 'Замечания технадзора закрыты.', progressPercent: 100, attachmentUrl: null }
  ];

  const requestDefs = [
    [1, 1, 'Submitted', 1, 'Демо MR-01: материалы для разметки осей', [[6, 30, 'грунт для закрепления меток'], [10, 80, 'защитные гильзы']]],
    [2, 2, 'Approved', 2, 'Демо MR-02: арматура и фиксаторы для плиты', [[2, 4.5, 'основной каркас'], [3, 1, 'доборные щиты']]],
    [3, 2, 'Submitted', 1, 'Демо MR-03: бетон для перекрытия', [[1, 28, 'поставка утром'], [2, 1.2, 'доборные стержни']]],
    [4, 3, 'Draft', 3, 'Демо MR-04: комплект под бетонирование колонн', [[1, 18, null], [3, 1, null]]],
    [5, 4, 'Issued', 1, 'Демо MR-05: опалубка для лестничного марша', [[3, 2, 'комплекты щитов'], [2, 0.8, null]]],
    [6, 5, 'Rejected', -1, 'Демо MR-06: гидроизоляционные материалы', [[6, 40, 'праймер'], [12, 120, 'рулонная мембрана']]],
    [7, 6, 'Submitted', 2, 'Демо MR-07: кирпич и раствор для перегородок', [[4, 3200, null], [5, 8, null]]],
    [8, 6, 'Approved', 3, 'Демо MR-08: доборные материалы для кладки', [[4, 900, 'резерв'], [6, 20, null]]],
    [9, 7, 'Draft', 5, 'Демо MR-09: штукатурка МОП', [[7, 160, null], [6, 50, null]]],
    [10, 8, 'Closed', -1, 'Демо MR-10: материалы для монтажа окон', [[6, 25, 'грунт проемов'], [10, 40, 'доборные элементы']]],
    [11, 9, 'Submitted', 1, 'Демо MR-11: материалы для стяжки', [[5, 12, 'раствор'], [6, 30, null]]],
    [12, 10, 'Draft', 6, 'Демо MR-12: плитка входной группы', [[8, 95, 'с запасом 7%'], [6, 20, null]]],
    [13, 11, 'Approved', 1, 'Демо MR-13: кабельные трассы', [[9, 650, 'основной кабель'], [10, 120, 'защитная труба']]],
    [14, 11, 'Submitted', 2, 'Демо MR-14: добор по электромонтажу', [[9, 180, null], [6, 10, null]]],
    [15, 12, 'Draft', 3, 'Демо MR-15: щит освещения', [[9, 90, 'подключение групп'], [10, 40, null]]],
    [16, 13, 'Issued', 1, 'Демо MR-16: вентиляционный короб', [[11, 75, 'оцинкованные секции'], [10, 30, 'крепление']]],
    [17, 14, 'Draft', 5, 'Демо MR-17: насосная станция', [[9, 120, 'питание насосов'], [10, 35, 'обвязка']]],
    [18, 15, 'Submitted', 1, 'Демо MR-18: пожарная сигнализация', [[9, 260, 'кабель шлейфов'], [10, 60, 'гофра']]],
    [19, 16, 'Approved', -2, 'Демо MR-19: кровельная мембрана', [[12, 450, null], [6, 80, 'праймер']]],
    [20, 17, 'Draft', 4, 'Демо MR-20: водосточная система', [[10, 140, 'стояки и выпуски'], [12, 60, 'узлы примыкания']]],
    [21, 18, 'Closed', 0, 'Демо MR-21: приемка арматуры', [[2, 6.5, 'поставка по накладной'], [6, 15, null]]],
    [22, 19, 'Closed', -2, 'Демо MR-22: устранение замечаний отделки', [[7, 45, null], [8, 18, null]]],
    [23, 20, 'Draft', 7, 'Демо MR-23: финальная уборка', [[6, 12, 'расходники'], [10, 20, null]]],
    [24, 1, 'Submitted', 2, 'Демо MR-24: дополнительный комплект для осей', [[6, 15, null], [9, 40, 'подсветка зоны']]],
    [25, 3, 'Approved', 4, 'Демо MR-25: резерв бетона для колонн', [[1, 10, 'резерв'], [2, 0.6, null]]],
    [26, 4, 'Submitted', 2, 'Демо MR-26: крепеж и доборы опалубки', [[3, 1, null], [10, 25, null]]],
    [27, 7, 'Draft', 6, 'Демо MR-27: добор штукатурки', [[7, 60, null], [6, 25, null]]],
    [28, 9, 'Issued', 1, 'Демо MR-28: материалы для стяжки секции Б', [[5, 9, null], [6, 18, null]]],
    [29, 13, 'Submitted', 3, 'Демо MR-29: дополнительные воздуховоды', [[11, 35, null], [10, 22, null]]],
    [30, 15, 'Approved', 2, 'Демо MR-30: расходники ПС', [[9, 130, null], [10, 40, null]]],
    [31, 16, 'Rejected', -1, 'Демо MR-31: повторная заявка по кровле', [[12, 210, 'требуется уточнение объема'], [6, 35, null]]],
    [32, 17, 'Submitted', 5, 'Демо MR-32: комплект водостока', [[10, 85, null], [12, 40, null]]]
  ];

  const materialRequests = [];
  const materialRequestItems = [];
  let requestItemId = 1;
  for (const [requestId, taskId, status, requiredOffset, comment, items] of requestDefs) {
    materialRequests.push({
      requestId,
      taskId,
      createdByUserId: 2,
      createdAt: isoNow(),
      requiredDate: addDays(date, requiredOffset),
      status,
      comment
    });

    for (const [materialId, qty, itemComment] of items) {
      materialRequestItems.push({
        requestItemId: requestItemId++,
        requestId,
        materialId,
        qty,
        comment: itemComment || null
      });
    }
  }

  const materialDeliveryDocs = [
    { deliveryDocId: 1, requestId: 5, eventType: 'Issued', eventAt: isoNow(), docNumber: 'M-0005', note: 'Выдано со склада' },
    { deliveryDocId: 2, requestId: 10, eventType: 'Delivered', eventAt: isoNow(), docNumber: 'M-0010', note: 'Доставлено на объект' },
    { deliveryDocId: 3, requestId: 16, eventType: 'Issued', eventAt: isoNow(), docNumber: 'M-0016', note: 'Выдача под монтаж' },
    { deliveryDocId: 4, requestId: 21, eventType: 'Closed', eventAt: isoNow(), docNumber: 'M-0021', note: 'Закрыто по приемке' }
  ];

  const dailyPlans = [
    { planId: 1, planDate: date, createdByUserId: 2, createdAt: isoNow(), comment: 'План работ на текущий день по всем бригадам', status: 'Утвержден' }
  ];

  const dailyPlanItems = [
    { planItemId: 1, planId: 1, taskId: 1, crewId: 1, sortOrder: 1, note: 'Закрыть исполнительную схему', materialsReady: true },
    { planItemId: 2, planId: 1, taskId: 2, crewId: 1, sortOrder: 2, note: 'Проверить фиксаторы до 12:00', materialsReady: false },
    { planItemId: 3, planId: 1, taskId: 18, crewId: 1, sortOrder: 3, note: 'Сверить сертификаты', materialsReady: true },
    { planItemId: 4, planId: 1, taskId: 6, crewId: 2, sortOrder: 1, note: 'Начать с осей 2-4', materialsReady: true },
    { planItemId: 5, planId: 1, taskId: 9, crewId: 2, sortOrder: 2, note: 'Контроль влажности основания', materialsReady: true },
    { planItemId: 6, planId: 1, taskId: 11, crewId: 3, sortOrder: 1, note: 'Не закрывать лотки до прозвонки', materialsReady: true },
    { planItemId: 7, planId: 1, taskId: 13, crewId: 3, sortOrder: 2, note: 'Проверить подвесы', materialsReady: true },
    { planItemId: 8, planId: 1, taskId: 15, crewId: 3, sortOrder: 3, note: 'Согласовать тест с охраной', materialsReady: false }
  ];

  return {
    sites,
    crews,
    crewMembers,
    priorities,
    taskStatuses,
    tasks,
    taskReports,
    materialCatalog,
    materialRequests,
    materialRequestItems,
    materialDeliveryDocs,
    dailyPlans,
    dailyPlanItems
  };
}

function taskSeed(date, taskId, siteId, crewId, title, description, startOffset, endOffset, priorityId, taskStatusId) {
  return {
    taskId,
    siteId,
    crewId,
    title,
    description,
    startDate: addDays(date, startOffset),
    endDate: addDays(date, endOffset),
    priorityId,
    taskStatusId,
    labelId: null,
    externalId: `seed:task:${String(taskId).padStart(2, '0')}`,
    publicCode: `T-${String(taskId).padStart(5, '0')}`,
    lastPrintedAt: null
  };
}

function ensureStarterRows(database, seeded) {
  for (const role of seeded.roles) {
    if (!database.roles.some(item => item.roleId === role.roleId)) database.roles.push(role);
  }

  for (const starter of [
    ...seeded.users,
    userSeed(4, 'maksim', 'maksim', 'Maksim', 1)
  ]) {
    const existing = database.users.find(item => item.username === starter.username);
    if (!existing) {
      const userToAdd = { ...starter };
      if (database.users.some(item => Number(item.userId) === Number(userToAdd.userId))) {
        userToAdd.userId = Math.max(0, ...database.users.map(item => Number(item.userId || 0))) + 1;
      }
      database.users.push(userToAdd);
    } else {
      existing.isActive = true;
      existing.roleId = starter.roleId;
      existing.fullName = existing.fullName || starter.fullName;
      if (starter.username === 'maksim' || !existing.passwordHash) setUserPassword(existing, starter.username);
    }
  }

  const siteIdMap = ensureSeedRows(database, 'sites', seeded.sites, 'siteId', site => site.siteCode || site.siteName);
  const crewIdMap = ensureSeedRows(database, 'crews', seeded.crews, 'crewId', crew => crew.externalId || crew.crewName);
  ensureSeedRows(
    database,
    'crewMembers',
    seeded.crewMembers.map(member => ({
      ...member,
      crewId: mappedId(crewIdMap, member.crewId)
    })),
    null,
    member => `${member.crewId}:${member.userId}`);
  ensureSeedRows(database, 'priorities', seeded.priorities, 'priorityId', priority => priority.priorityName);
  ensureSeedRows(database, 'taskStatuses', seeded.taskStatuses, 'taskStatusId', status => status.taskStatusName);

  const taskIdMap = ensureSeedRows(
    database,
    'tasks',
    seeded.tasks.map(task => ({
      ...task,
      siteId: mappedId(siteIdMap, task.siteId),
      crewId: mappedId(crewIdMap, task.crewId)
    })),
    'taskId',
    task => task.externalId || task.publicCode || task.title);
  ensureSeedRows(
    database,
    'taskReports',
    seeded.taskReports.map(report => ({
      ...report,
      taskId: mappedId(taskIdMap, report.taskId)
    })),
    'reportId',
    report => `seed-report:${report.taskId}:${report.progressPercent}:${report.reportText}`);
  ensureSeedRows(database, 'materialCatalog', seeded.materialCatalog, 'materialId', material => material.code || `${material.name}:${material.unit}`);

  const materialRequestIdMap = ensureSeedMaterialRequests(
    database,
    seeded.materialRequests.map(request => ({
      ...request,
      taskId: mappedId(taskIdMap, request.taskId)
    })),
    seeded.materialRequestItems);
  ensureSeedRows(
    database,
    'materialDeliveryDocs',
    seeded.materialDeliveryDocs.map(doc => ({
      ...doc,
      requestId: mappedId(materialRequestIdMap, doc.requestId)
    })),
    'deliveryDocId',
    doc => `seed-doc:${doc.requestId}:${doc.eventType}:${doc.docNumber || ''}`);

  const planIdMap = ensureSeedRows(database, 'dailyPlans', seeded.dailyPlans, 'planId', plan => plan.planDate);
  ensureSeedRows(
    database,
    'dailyPlanItems',
    seeded.dailyPlanItems.map(item => ({
      ...item,
      planId: mappedId(planIdMap, item.planId),
      taskId: mappedId(taskIdMap, item.taskId),
      crewId: mappedId(crewIdMap, item.crewId)
    })),
    'planItemId',
    item => `seed-plan:${item.planId}:${item.taskId}:${item.crewId}`);
}

function ensureSeedRows(database, collectionName, seededRows, idField, keySelector) {
  const idMap = new Map();
  if (!Array.isArray(database[collectionName])) {
    database[collectionName] = [];
  }

  for (const seedRow of seededRows || []) {
    const seedKey = keySelector(seedRow);
    const existing = database[collectionName].find(row => same(keySelector(row), seedKey));
    if (existing) {
      if (seedRow.externalId && !existing.externalId) existing.externalId = seedRow.externalId;
      if (seedRow.isActive !== undefined) existing.isActive = seedRow.isActive;
      if (idField) idMap.set(Number(seedRow[idField]), Number(existing[idField]));
      continue;
    }

    const row = { ...seedRow };
    if (idField && database[collectionName].some(item => Number(item[idField]) === Number(row[idField]))) {
      row[idField] = nextSeedId(database[collectionName], idField);
    }
    database[collectionName].push(row);
    if (idField) idMap.set(Number(seedRow[idField]), Number(row[idField]));
  }

  return idMap;
}

function ensureSeedMaterialRequests(database, seededRequests, seededItems) {
  const requestIdMap = new Map();
  if (!Array.isArray(database.materialRequests)) database.materialRequests = [];
  if (!Array.isArray(database.materialRequestItems)) database.materialRequestItems = [];

  const itemsByRequestId = new Map();
  for (const item of seededItems || []) {
    addIndexed(itemsByRequestId, Number(item.requestId), item);
  }

  for (const seedRequest of seededRequests || []) {
    const marker = materialRequestSeedMarker(seedRequest.comment);
    const exists = marker && database.materialRequests.some(request =>
      String(request.comment || '').includes(marker));
    if (exists) {
      const existing = database.materialRequests.find(request =>
        String(request.comment || '').includes(marker));
      if (existing) requestIdMap.set(Number(seedRequest.requestId), Number(existing.requestId));
      continue;
    }

    const request = { ...seedRequest };
    const originalRequestId = request.requestId;
    if (database.materialRequests.some(item => Number(item.requestId) === Number(request.requestId))) {
      request.requestId = nextSeedId(database.materialRequests, 'requestId');
    }

    database.materialRequests.push(request);
    requestIdMap.set(Number(originalRequestId), Number(request.requestId));
    for (const seedItem of itemsByRequestId.get(Number(originalRequestId)) || []) {
      const item = { ...seedItem, requestId: request.requestId };
      if (database.materialRequestItems.some(existing => Number(existing.requestItemId) === Number(item.requestItemId))) {
        item.requestItemId = nextSeedId(database.materialRequestItems, 'requestItemId');
      }
      database.materialRequestItems.push(item);
    }
  }

  return requestIdMap;
}

function mappedId(idMap, id) {
  return idMap && idMap.has(Number(id)) ? idMap.get(Number(id)) : id;
}

function materialRequestSeedMarker(comment) {
  const match = /Демо MR-\d+/i.exec(String(comment || ''));
  return match ? match[0] : null;
}

function nextSeedId(rows, idField) {
  return Math.max(0, ...rows.map(item => Number(item[idField] || 0))) + 1;
}

function rebuildCounters(database) {
  const collections = [
    ['roles', 'roleId'],
    ['users', 'userId'],
    ['sites', 'siteId'],
    ['crews', 'crewId'],
    ['tasks', 'taskId'],
    ['taskReports', 'reportId'],
    ['taskPrintLogs', 'printLogId'],
    ['materialCatalog', 'materialId'],
    ['materialRequests', 'requestId'],
    ['materialRequestItems', 'requestItemId'],
    ['materialRequestStatusLog', 'statusLogId'],
    ['materialDeliveryDocs', 'deliveryDocId'],
    ['dailyPlans', 'planId'],
    ['dailyPlanItems', 'planItemId']
  ];

  for (const [collection, idField] of collections) {
    const max = Math.max(0, ...database[collection].map(item => Number(item[idField] || 0)));
    database.counters[collection] = Math.max(Number(database.counters[collection] || 0), max + 1);
  }
}

function nextId(collection, idField) {
  const id = Number(db.counters[collection] || 1);
  db.counters[collection] = id + 1;
  return id;
}

function createToken(user) {
  const payload = base64Url(JSON.stringify({ userId: user.userId, exp: Date.now() + TOKEN_LIFETIME_MS }));
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

function getAuthenticatedUser(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;

  const [payload, signature] = match[1].split('.');
  if (!payload || !signature || sign(payload) !== signature) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed.exp || parsed.exp < Date.now()) return null;
    return joinUser(Number(parsed.userId));
  } catch {
    return null;
  }
}

function sign(payload) {
  return crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
}

function userSeed(userId, username, password, fullName, roleId) {
  const user = { userId, username, fullName, roleId, isActive: true, preferredTheme: 'Light', accentColor: 'Brown', telegramId: null };
  setUserPassword(user, password);
  return user;
}

function setUserPassword(user, password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  user.passwordSalt = salt;
  user.passwordIterations = PASSWORD_ITERATIONS;
  user.passwordHash = crypto.pbkdf2Sync(String(password), salt, PASSWORD_ITERATIONS, 32, 'sha256').toString('base64url');
}

function verifyPassword(password, user) {
  if (!user.passwordHash || !user.passwordSalt) return false;
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(String(password), user.passwordSalt, Number(user.passwordIterations || PASSWORD_ITERATIONS), 32, 'sha256', (error, key) => {
      if (error) {
        reject(error);
        return;
      }

      const expected = Buffer.from(user.passwordHash, 'base64url');
      resolve(expected.length === key.length && crypto.timingSafeEqual(key, expected));
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > MAX_REQUEST_BODY_BYTES) {
        req.destroy();
        reject(new Error('Request body is too large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function noContent(res) {
  res.writeHead(204);
  res.end();
}

function routeParts(pathname) {
  return pathname.split('/').filter(Boolean).slice(1);
}

function joinRole(roleId) {
  return indexes.rolesById.get(Number(roleId)) || null;
}

function joinUser(userId) {
  const user = indexes.usersById.get(Number(userId));
  return user && user.isActive !== false ? user : null;
}

function joinSite(siteId) {
  const site = indexes.sitesById.get(Number(siteId));
  return site && site.isActive !== false ? site : null;
}

function joinCrew(crewId) {
  const crew = indexes.crewsById.get(Number(crewId));
  return crew && crew.isActive !== false ? crew : null;
}

function joinPriority(priorityId) {
  return indexes.prioritiesById.get(Number(priorityId)) || null;
}

function joinStatus(statusId) {
  return indexes.statusesById.get(Number(statusId)) || null;
}

function isOverdue(task) {
  const status = joinStatus(task.taskStatusId)?.taskStatusName || '';
  return task.endDate < today() && status !== 'Завершено';
}

function same(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function normalizeDate(value) {
  if (!value) return today();
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date, days) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function isoNow() {
  return new Date().toISOString();
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function actionStatus(action) {
  return {
    submit: 'Submitted',
    approve: 'Approved',
    reject: 'Rejected',
    issue: 'Issued',
    deliver: 'Delivered',
    close: 'Closed'
  }[action] || action;
}

function buildEmployeeLogin(fullName) {
  const letters = String(fullName || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 16);
  return `${letters || 'employee'}${new Date().toISOString().replace(/\D/g, '').slice(8, 14)}`;
}

module.exports = { handleApi, DB_FILE };
