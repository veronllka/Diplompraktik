const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'brigadeplanner-db.json');
const TOKEN_SECRET = process.env.JWT_SECRET || process.env.TOKEN_SECRET || 'brigadeplanner-miniapp-local-secret';
const TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 120000;

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

let db = loadDatabase();

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

    if (method === 'GET' && pathname === '/api/task-reports') {
      return json(res, 200, db.taskReports.map(taskReportDto));
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

    if (route[0] === 'reports') {
      return handleReports(res, method, route);
    }

    if (route[0] === 'brigadier') {
      return handleBrigadier(res, method, route, body, requestUrl.searchParams, user);
    }

    if (route[0] === 'materials') {
      return handleMaterials(res, method, route);
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

function login(res, body) {
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const user = db.users.find(item => item.isActive !== false && item.username === username);

  if (!user || !verifyPassword(password, user)) {
    return json(res, 401, { error: 'Invalid username or password' });
  }

  return json(res, 200, { token: createToken(user), user: userDto(user) });
}

function telegramLogin(res) {
  const user = db.users.find(item => item.username === '3') || db.users[0];
  return json(res, 200, { token: createToken(user), user: userDto(user) });
}

function handleUsers(res, method, route, body, currentUser) {
  if (method === 'POST' && route[1] === 'change-password') {
    if (!verifyPassword(String(body.oldPassword || ''), currentUser)) {
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

function handleSites(res, method, route, body) {
  if (method === 'GET' && route.length === 1) {
    return json(res, 200, db.sites.map(siteDto));
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
    const crew = {
      crewId: nextId('crews', 'crewId'),
      crewName: body.crewName || '',
      brigadierId: body.brigadierId ? Number(body.brigadierId) : null,
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
    const task = {
      taskId: nextId('tasks', 'taskId'),
      siteId: Number(body.siteId),
      crewId: body.crewId ? Number(body.crewId) : null,
      title: body.title || '',
      description: body.description || null,
      startDate: normalizeDate(body.startDate || today()),
      endDate: normalizeDate(body.endDate || today()),
      priorityId: Number(body.priorityId || 2),
      taskStatusId: Number(body.taskStatusId || body.statusId || 1),
      labelId: body.labelId || null,
      publicCode: null,
      lastPrintedAt: null
    };
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
    task.siteId = Number(body.siteId || task.siteId);
    task.crewId = body.crewId ? Number(body.crewId) : null;
    task.title = body.title || task.title;
    task.description = body.description || null;
    task.startDate = normalizeDate(body.startDate || task.startDate);
    task.endDate = normalizeDate(body.endDate || task.endDate);
    task.priorityId = Number(body.priorityId || task.priorityId);
    task.taskStatusId = Number(body.taskStatusId || body.statusId || task.taskStatusId);
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
    const task = db.tasks.find(item => same(item.publicCode, route[3]));
    return task ? json(res, 200, taskDto(task)) : json(res, 404, { error: 'Task not found' });
  }

  if (method === 'GET' && route[1] === 'tasks' && route.length === 3) {
    const task = db.tasks.find(item => item.taskId === Number(route[2]));
    return task ? json(res, 200, taskDto(task)) : json(res, 404, { error: 'Task not found' });
  }

  if (method === 'POST' && route[1] === 'tasks' && route[3] === 'status') {
    const task = db.tasks.find(item => item.taskId === Number(route[2]));
    if (!task) return json(res, 404, { error: 'Task not found' });
    changeTaskStatus(task, Number(body.statusId || body.taskStatusId || task.taskStatusId), body.comment, user);
    return noContent(res);
  }

  if (method === 'POST' && route[1] === 'tasks' && route[3] === 'comment') {
    addTaskReport(Number(route[2]), user.userId, body.comment || '', null, null);
    return noContent(res);
  }

  if (method === 'POST' && route[1] === 'tasks' && route[3] === 'postpone') {
    const task = db.tasks.find(item => item.taskId === Number(route[2]));
    if (!task) return json(res, 404, { error: 'Task not found' });
    const oldEndDate = task.endDate;
    task.endDate = normalizeDate(body.newEndDate || task.endDate);
    addTaskReport(task.taskId, user.userId, `Перенесена с ${oldEndDate} на ${task.endDate}. ${body.comment || ''}`, null, null, false);
    saveDatabase();
    return noContent(res);
  }

  if (method === 'GET' && route[1] === 'tasks' && route[3] === 'qr') {
    const task = db.tasks.find(item => item.taskId === Number(route[2]));
    return task ? json(res, 200, { taskId: task.taskId, qrData: task.publicCode || `T-${task.taskId}` }) : json(res, 404, { error: 'Task not found' });
  }

  if (method === 'GET' && route[1] === 'calendar') {
    return json(res, 200, calendarDays(user, Number(query.get('year')), Number(query.get('month'))));
  }

  return json(res, 404, { error: 'Brigadier endpoint not found' });
}

function handleMaterials(res, method, route) {
  if (method === 'GET' && route[1] === 'catalog') {
    return json(res, 200, db.materialCatalog.map(m => ({
      materialId: m.materialId,
      name: m.name,
      unit: m.unit,
      code: m.code,
      isActive: m.isActive !== false
    })));
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
  const crewIds = db.crews.filter(c => c.brigadierId === user.userId || db.crewMembers.some(m => m.crewId === c.crewId && m.userId === user.userId && !m.leftAt)).map(c => c.crewId);
  const source = crewIds.length > 0 ? db.tasks.filter(t => crewIds.includes(t.crewId)) : db.tasks;
  return source.filter(task => task.startDate <= normalized && task.endDate >= normalized);
}

function brigadierDashboard(user, date) {
  const normalized = normalizeDate(date);
  const tasks = brigadierTasks(user, normalized);
  const crew = db.crews.find(c => c.brigadierId === user.userId)
    || db.crews.find(c => db.crewMembers.some(m => m.crewId === c.crewId && m.userId === user.userId && !m.leftAt));
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
  const result = [];

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    const tasks = brigadierTasks(user, date);
    if (tasks.length > 0) {
      result.push({ date, taskCount: tasks.length, hasOverdue: tasks.some(isOverdue) });
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
    taskStatusName: status?.taskStatusName || null
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
    brigadierName: brigadier?.fullName || null
  };
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
  const task = db.tasks.find(item => item.taskId === report.taskId);
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
  const task = db.tasks.find(item => item.taskId === request.taskId);
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
    siteName: site?.siteName || null,
    crewName: crew?.crewName || null,
    items: db.materialRequestItems.filter(item => item.requestId === request.requestId).map(materialRequestItemDto)
  };
}

function materialRequestItemDto(item) {
  const material = db.materialCatalog.find(m => m.materialId === item.materialId);
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
    items: db.dailyPlanItems.filter(item => item.planId === plan.planId).map(dailyPlanItemDto)
  };
}

function dailyPlanItemDto(item) {
  const task = db.tasks.find(t => t.taskId === item.taskId);
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
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(database, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

function ensureDatabase(database) {
  const seeded = seedDatabase();
  for (const key of Object.keys(seeded)) {
    if (Array.isArray(seeded[key]) && !Array.isArray(database[key])) database[key] = seeded[key];
    if (key === 'rolePermissions' && !database[key]) database[key] = seeded[key];
    if (key === 'counters' && !database[key]) database[key] = {};
  }

  ensureStarterRows(database);
  rebuildCounters(database);
  return database;
}

function seedDatabase() {
  const date = today();
  const tomorrow = addDays(date, 1);
  const nextWeek = addDays(date, 7);
  const pastStart = addDays(date, -5);
  const pastEnd = addDays(date, -1);
  const admin = userSeed(1, '1', '1', 'Администратор', 1);
  const dispatcher = userSeed(2, '2', '2', 'Диспетчер', 2);
  const brigadier = userSeed(3, '3', '3', 'Бригадир', 3);

  return {
    counters: {},
    roles: [
      { roleId: 1, roleName: 'Администратор' },
      { roleId: 2, roleName: 'Диспетчер' },
      { roleId: 3, roleName: 'Бригадир' }
    ],
    rolePermissions: {},
    users: [admin, dispatcher, brigadier],
    sites: [
      { siteId: 1, siteCode: 'SEV-01', siteName: 'Северный квартал', address: 'г. Москва, ул. Северная, 10', isActive: true },
      { siteId: 2, siteCode: 'ZAP-02', siteName: 'Западный мост', address: 'г. Москва, пр-т Западный, 25', isActive: true }
    ],
    crews: [
      { crewId: 1, crewName: 'Бригада 1', brigadierId: 3, isActive: true }
    ],
    crewMembers: [
      { crewId: 1, userId: 3, joinedAt: date, leftAt: null }
    ],
    priorities: [
      { priorityId: 1, priorityName: 'Низкий', sortOrder: 1 },
      { priorityId: 2, priorityName: 'Средний', sortOrder: 2 },
      { priorityId: 3, priorityName: 'Высокий', sortOrder: 3 },
      { priorityId: 4, priorityName: 'Критичный', sortOrder: 4 }
    ],
    taskStatuses: [
      { taskStatusId: 1, taskStatusName: 'Новая' },
      { taskStatusId: 2, taskStatusName: 'В работе' },
      { taskStatusId: 3, taskStatusName: 'Завершено' },
      { taskStatusId: 4, taskStatusName: 'Просрочено' }
    ],
    tasks: [
      { taskId: 1, siteId: 1, crewId: 1, title: 'Проверка объекта', description: 'Первичный осмотр участка', startDate: date, endDate: tomorrow, priorityId: 2, taskStatusId: 2, labelId: null, publicCode: 'T-00001', lastPrintedAt: null },
      { taskId: 2, siteId: 1, crewId: 1, title: 'Заливка фундамента', description: 'Монолитные работы, карта N3', startDate: date, endDate: nextWeek, priorityId: 4, taskStatusId: 1, labelId: null, publicCode: 'T-00002', lastPrintedAt: null },
      { taskId: 3, siteId: 2, crewId: 1, title: 'Подготовка материалов', description: 'Проверить поставку арматуры', startDate: date, endDate: tomorrow, priorityId: 3, taskStatusId: 1, labelId: null, publicCode: 'T-00003', lastPrintedAt: null },
      { taskId: 4, siteId: 2, crewId: 1, title: 'Закрыть старый наряд', description: 'Проверить просроченный наряд', startDate: pastStart, endDate: pastEnd, priorityId: 2, taskStatusId: 2, labelId: null, publicCode: 'T-00004', lastPrintedAt: null }
    ],
    taskReports: [
      { reportId: 1, taskId: 1, reportedByUserId: 3, reportedAt: isoNow(), reportText: 'Работы приняты в план.', progressPercent: 10, attachmentUrl: null }
    ],
    taskPrintLogs: [],
    materialCatalog: [
      { materialId: 1, name: 'Бетон B25', unit: 'м3', code: 'BET-B25', isActive: true },
      { materialId: 2, name: 'Арматура A500', unit: 'т', code: 'ARM-A500', isActive: true },
      { materialId: 3, name: 'Опалубка', unit: 'компл.', code: 'OPL', isActive: true }
    ],
    materialRequests: [
      { requestId: 1, taskId: 2, createdByUserId: 2, createdAt: isoNow(), requiredDate: tomorrow, status: 'Submitted', comment: 'Материалы для фундамента' }
    ],
    materialRequestItems: [
      { requestItemId: 1, requestId: 1, materialId: 1, qty: 12, comment: null },
      { requestItemId: 2, requestId: 1, materialId: 2, qty: 2, comment: null }
    ],
    materialRequestStatusLog: [],
    materialDeliveryDocs: [],
    dailyPlans: [],
    dailyPlanItems: []
  };
}

function ensureStarterRows(database) {
  for (const role of seedDatabase().roles) {
    if (!database.roles.some(item => item.roleId === role.roleId)) database.roles.push(role);
  }

  for (const starter of [userSeed(1, '1', '1', 'Администратор', 1), userSeed(2, '2', '2', 'Диспетчер', 2), userSeed(3, '3', '3', 'Бригадир', 3)]) {
    const existing = database.users.find(item => item.username === starter.username);
    if (!existing) database.users.push(starter);
    else {
      existing.isActive = true;
      existing.roleId = starter.roleId;
      existing.fullName = existing.fullName || starter.fullName;
      if (!existing.passwordHash) setUserPassword(existing, starter.username);
    }
  }

  if (!database.sites.length) database.sites = seedDatabase().sites;
  if (!database.crews.length) database.crews = seedDatabase().crews;
  if (!database.crewMembers.length) database.crewMembers = seedDatabase().crewMembers;
  if (!database.priorities.length) database.priorities = seedDatabase().priorities;
  if (!database.taskStatuses.length) database.taskStatuses = seedDatabase().taskStatuses;
  if (!database.tasks.length) database.tasks = seedDatabase().tasks;
  if (!database.materialCatalog.length) database.materialCatalog = seedDatabase().materialCatalog;
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
  const candidate = crypto.pbkdf2Sync(String(password), user.passwordSalt, Number(user.passwordIterations || PASSWORD_ITERATIONS), 32, 'sha256').toString('base64url');
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(user.passwordHash));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 2_000_000) {
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
  return db.roles.find(role => role.roleId === Number(roleId));
}

function joinUser(userId) {
  return db.users.find(user => user.userId === Number(userId) && user.isActive !== false) || null;
}

function joinSite(siteId) {
  return db.sites.find(site => site.siteId === Number(siteId)) || null;
}

function joinCrew(crewId) {
  return db.crews.find(crew => crew.crewId === Number(crewId)) || null;
}

function joinPriority(priorityId) {
  return db.priorities.find(priority => priority.priorityId === Number(priorityId)) || null;
}

function joinStatus(statusId) {
  return db.taskStatuses.find(status => status.taskStatusId === Number(statusId)) || null;
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
