/* ============================================================
   BrigadePlanner — таблицы + заполнение (без переменных)
   Пользователи (учебно! plaintext): 1/1 (Админ), 2/2 (Диспетчер), 3/3 (Бригадир)
   ============================================================*/

IF DB_ID(N'BrigadePlanner') IS NULL
    CREATE DATABASE [BrigadePlanner];
GO
USE [BrigadePlanner];
GO
SET NOCOUNT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

---------------------------------------------------------------
-- Чистим (в правильном порядке)
---------------------------------------------------------------
IF OBJECT_ID('dbo.TaskReports','U')    IS NOT NULL DROP TABLE dbo.TaskReports;
IF OBJECT_ID('dbo.Tasks','U')          IS NOT NULL DROP TABLE dbo.Tasks;
IF OBJECT_ID('dbo.CrewMembers','U')    IS NOT NULL DROP TABLE dbo.CrewMembers;
IF OBJECT_ID('dbo.Crews','U')          IS NOT NULL DROP TABLE dbo.Crews;
IF OBJECT_ID('dbo.Sites','U')          IS NOT NULL DROP TABLE dbo.Sites;
IF OBJECT_ID('dbo.TaskStatuses','U')   IS NOT NULL DROP TABLE dbo.TaskStatuses;
IF OBJECT_ID('dbo.TaskPriorities','U') IS NOT NULL DROP TABLE dbo.TaskPriorities;
IF OBJECT_ID('dbo.UserRoles','U')      IS NOT NULL DROP TABLE dbo.UserRoles;
IF OBJECT_ID('dbo.Users','U')          IS NOT NULL DROP TABLE dbo.Users;
IF OBJECT_ID('dbo.Roles','U')          IS NOT NULL DROP TABLE dbo.Roles;

---------------------------------------------------------------
-- Таблицы
---------------------------------------------------------------
CREATE TABLE dbo.Roles(
    RoleId   TINYINT       NOT NULL PRIMARY KEY,
    RoleName NVARCHAR(50)  NOT NULL UNIQUE
);

CREATE TABLE dbo.Users(
    UserId        INT           IDENTITY(1,1) PRIMARY KEY,
    LoginName     NVARCHAR(64)  NOT NULL UNIQUE,
    PasswordPlain NVARCHAR(255) NOT NULL,
    FullName      NVARCHAR(200) NOT NULL,
    IsActive      BIT           NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT(1),
    CreatedAt     DATETIME2(3)  NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT (SYSUTCDATETIME())
);

CREATE TABLE dbo.UserRoles(
    UserId INT     NOT NULL,
    RoleId TINYINT NOT NULL,
    PRIMARY KEY(UserId, RoleId),
    CONSTRAINT FK_UserRoles_Users FOREIGN KEY(UserId) REFERENCES dbo.Users(UserId),
    CONSTRAINT FK_UserRoles_Roles FOREIGN KEY(RoleId) REFERENCES dbo.Roles(RoleId)
);

CREATE TABLE dbo.Sites(
    SiteId    INT           IDENTITY(1,1) PRIMARY KEY,
    SiteCode  NVARCHAR(30)  NULL UNIQUE,
    SiteName  NVARCHAR(200) NOT NULL,
    Address   NVARCHAR(300) NULL,
    IsActive  BIT           NOT NULL CONSTRAINT DF_Sites_IsActive DEFAULT(1)
);

CREATE TABLE dbo.Crews(
    CrewId        INT           IDENTITY(1,1) PRIMARY KEY,
    CrewName      NVARCHAR(120) NOT NULL UNIQUE,
    ForemanUserId INT           NOT NULL,
    IsActive      BIT           NOT NULL CONSTRAINT DF_Crews_IsActive DEFAULT(1),
    CONSTRAINT FK_Crews_Foreman FOREIGN KEY(ForemanUserId) REFERENCES dbo.Users(UserId)
);

CREATE TABLE dbo.CrewMembers(
    CrewId    INT  NOT NULL,
    UserId    INT  NOT NULL,
    JoinedAt  DATE NOT NULL CONSTRAINT DF_CrewMembers_JoinedAt DEFAULT (CAST(SYSUTCDATETIME() AS DATE)),
    LeftAt    DATE NULL,
    PRIMARY KEY(CrewId, UserId, JoinedAt),
    CONSTRAINT FK_CrewMembers_Crews FOREIGN KEY(CrewId) REFERENCES dbo.Crews(CrewId) ON DELETE CASCADE,
    CONSTRAINT FK_CrewMembers_Users FOREIGN KEY(UserId) REFERENCES dbo.Users(UserId)
);

CREATE TABLE dbo.TaskPriorities(
    PriorityId   TINYINT       NOT NULL PRIMARY KEY,
    PriorityName NVARCHAR(40)  NOT NULL UNIQUE,
    SortOrder    TINYINT       NOT NULL
);

CREATE TABLE dbo.TaskStatuses(
    StatusId   TINYINT       NOT NULL PRIMARY KEY,
    StatusName NVARCHAR(40)  NOT NULL UNIQUE
);

CREATE TABLE dbo.Tasks(
    TaskId      INT            IDENTITY(1,1) PRIMARY KEY,
    SiteId      INT            NOT NULL,
    CrewId      INT            NOT NULL,
    Title       NVARCHAR(200)  NOT NULL,
    Description NVARCHAR(MAX)  NULL,
    StartDate   DATE           NOT NULL,
    EndDate     DATE           NOT NULL,
    PriorityId  TINYINT        NOT NULL,
    StatusId    TINYINT        NOT NULL,
    CONSTRAINT FK_Tasks_Sites     FOREIGN KEY(SiteId)     REFERENCES dbo.Sites(SiteId),
    CONSTRAINT FK_Tasks_Crews     FOREIGN KEY(CrewId)     REFERENCES dbo.Crews(CrewId),
    CONSTRAINT FK_Tasks_Priority  FOREIGN KEY(PriorityId) REFERENCES dbo.TaskPriorities(PriorityId),
    CONSTRAINT FK_Tasks_Status    FOREIGN KEY(StatusId)   REFERENCES dbo.TaskStatuses(StatusId),
    CONSTRAINT CK_Tasks_Dates CHECK (StartDate <= EndDate)
);

CREATE TABLE dbo.TaskReports(
    ReportId         BIGINT         IDENTITY(1,1) PRIMARY KEY,
    TaskId           INT            NOT NULL,
    ReportedByUserId INT            NOT NULL,
    ReportedAt       DATETIME2(3)   NOT NULL CONSTRAINT DF_TaskReports_ReportedAt DEFAULT (SYSUTCDATETIME()),
    ReportText       NVARCHAR(MAX)  NULL,
    ProgressPercent  TINYINT        NULL,
    AttachmentUrl    NVARCHAR(500)  NULL,
    CONSTRAINT FK_TR_Task FOREIGN KEY(TaskId)           REFERENCES dbo.Tasks(TaskId) ON DELETE CASCADE,
    CONSTRAINT FK_TR_User FOREIGN KEY(ReportedByUserId) REFERENCES dbo.Users(UserId),
    CONSTRAINT CK_TR_Progress CHECK (ProgressPercent BETWEEN 0 AND 100 OR ProgressPercent IS NULL)
);

---------------------------------------------------------------
-- Данные словарей
---------------------------------------------------------------
INSERT INTO dbo.Roles(RoleId, RoleName) VALUES
(1,N'Администратор'),
(2,N'Диспетчер'),
(3,N'Бригадир');

INSERT INTO dbo.TaskPriorities(PriorityId, PriorityName, SortOrder) VALUES
(1,N'Низкий',1),(2,N'Средний',2),(3,N'Высокий',3),(4,N'Критичный',4);

INSERT INTO dbo.TaskStatuses(StatusId, StatusName) VALUES
(1,N'Новая'),(2,N'В работе'),(3,N'Завершено'),(4,N'Просрочено');

---------------------------------------------------------------
-- Пользователи (логины/пароли — как просили)
---------------------------------------------------------------
INSERT INTO dbo.Users(LoginName, PasswordPlain, FullName) VALUES
(N'1', N'1', N'Администратор'),
(N'2', N'2', N'Диспетчер'),
(N'3', N'3', N'Бригадир');

INSERT INTO dbo.UserRoles(UserId, RoleId)
SELECT (SELECT UserId FROM dbo.Users WHERE LoginName=N'1'), 1
UNION ALL
SELECT (SELECT UserId FROM dbo.Users WHERE LoginName=N'2'), 2
UNION ALL
SELECT (SELECT UserId FROM dbo.Users WHERE LoginName=N'3'), 3;


INSERT INTO dbo.Sites(SiteCode, SiteName, Address) VALUES
(N'SEV-01', N'Северный квартал', N'г. Москва, ул. Северная, 10'),
(N'ZAP-02', N'Западный мост',    N'г. Москва, пр-т Западный, 25');

INSERT INTO dbo.Crews(CrewName, ForemanUserId)
SELECT N'Бригада 1', u.UserId
FROM dbo.Users u
WHERE u.LoginName = N'3';

INSERT INTO dbo.CrewMembers(CrewId, UserId)
SELECT (SELECT CrewId FROM dbo.Crews WHERE CrewName=N'Бригада 1'),
       (SELECT UserId FROM dbo.Users WHERE LoginName=N'3');

---------------------------------------------------------------
-- Задачи (4 шт.) — каждая вставка отдельной командой без переменных
---------------------------------------------------------------
-- 1) Заливка фундамента (SEV-01, Бригада 1)
INSERT INTO dbo.Tasks(SiteId,CrewId,Title,Description,StartDate,EndDate,PriorityId,StatusId)
SELECT s.SiteId, c.CrewId, N'Заливка фундамента', N'Монолитные работы, карта №3',
       '2025-08-25','2025-09-05', 4, 2
FROM dbo.Sites s
JOIN dbo.Crews c ON c.CrewName=N'Бригада 1'
WHERE s.SiteCode=N'SEV-01';

-- 2) Армирование стен 1 очереди (SEV-01)
INSERT INTO dbo.Tasks(SiteId,CrewId,Title,Description,StartDate,EndDate,PriorityId,StatusId)
SELECT s.SiteId, c.CrewId, N'Армирование стен 1 очереди', N'Связка арматуры А500',
       '2025-06-01','2025-08-01', 3, 3
FROM dbo.Sites s
JOIN dbo.Crews c ON c.CrewName=N'Бригада 1'
WHERE s.SiteCode=N'SEV-01';

-- 3) Подготовка опор (ZAP-02)
INSERT INTO dbo.Tasks(SiteId,CrewId,Title,Description,StartDate,EndDate,PriorityId,StatusId)
SELECT s.SiteId, c.CrewId, N'Подготовка опор', N'Буронабивные сваи',
       '2025-08-10','2025-08-31', 3, 4
FROM dbo.Sites s
JOIN dbo.Crews c ON c.CrewName=N'Бригада 1'
WHERE s.SiteCode=N'ZAP-02';

-- 4) Монтаж лесов (ZAP-02)
INSERT INTO dbo.Tasks(SiteId,CrewId,Title,Description,StartDate,EndDate,PriorityId,StatusId)
SELECT s.SiteId, c.CrewId, N'Монтаж лесов', N'Подготовительные работы',
       '2025-09-10','2025-09-20', 2, 1
FROM dbo.Sites s
JOIN dbo.Crews c ON c.CrewName=N'Бригада 1'
WHERE s.SiteCode=N'ZAP-02';

---------------------------------------------------------------
-- Отчёты по задачам (без переменных)
---------------------------------------------------------------
INSERT INTO dbo.TaskReports(TaskId, ReportedByUserId, ReportText, ProgressPercent)
SELECT
  (SELECT TaskId FROM dbo.Tasks WHERE Title=N'Заливка фундамента'),
  (SELECT UserId FROM dbo.Users WHERE LoginName=N'3'),
  N'Опалубка собрана, начата заливка.', 40;

INSERT INTO dbo.TaskReports(TaskId, ReportedByUserId, ReportText, ProgressPercent)
SELECT
  (SELECT TaskId FROM dbo.Tasks WHERE Title=N'Подготовка опор'),
  (SELECT UserId FROM dbo.Users WHERE LoginName=N'3'),
  N'Отставание из-за поставок. Перенос сроков.', 70;

INSERT INTO dbo.TaskReports(TaskId, ReportedByUserId, ReportText, ProgressPercent)
SELECT
  (SELECT TaskId FROM dbo.Tasks WHERE Title=N'Монтаж лесов'),
  (SELECT UserId FROM dbo.Users WHERE LoginName=N'3'),
  N'Леса привезены, монтаж после 10.09.', NULL;

PRINT N'Готово. Логины/пароли: 1/1 (админ), 2/2 (диспетчер), 3/3 (бригадир).';

/* =========================================================
   0) ПОДГОТОВКА: полезные предпосылки и соглашения
   Предполагаем существующие таблицы:
     - dbo.Tasks (PK: TaskId INT)
     - dbo.Users (PK: UserId INT)
   Если они называются иначе — поправь ссылки на FK ниже.
   ========================================================= */

------------------------------------------------------------
-- 1) СПРАВОЧНИК МЕТОК ЗАДАЧ + ПРИВЯЗКА К ЗАДАЧАМ
------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[TaskLabels]') AND type = N'U')
BEGIN
    CREATE TABLE dbo.TaskLabels (
        LabelId       INT IDENTITY(1,1) PRIMARY KEY,
        Code          NVARCHAR(50)  NOT NULL UNIQUE,  -- 'urgent','await_mts','ready_accept'
        Name          NVARCHAR(100) NOT NULL,         -- 'Срочно','Ожидание МТС','Готово к приемке'
        ColorHex      NVARCHAR(7)   NOT NULL,         -- '#RRGGBB'
        SortOrder     INT           NOT NULL DEFAULT(100),
        IsActive      BIT           NOT NULL DEFAULT(1)
    );
END;
GO

-- Наполнение справочника меток (idempotent)
IF NOT EXISTS (SELECT 1 FROM dbo.TaskLabels WHERE Code = N'urgent')
    INSERT INTO dbo.TaskLabels (Code, Name, ColorHex, SortOrder) VALUES (N'urgent', N'Срочно',         N'#E53935', 10);
IF NOT EXISTS (SELECT 1 FROM dbo.TaskLabels WHERE Code = N'await_mts')
    INSERT INTO dbo.TaskLabels (Code, Name, ColorHex, SortOrder) VALUES (N'await_mts', N'Ожидание МТС', N'#FDD835', 20);
IF NOT EXISTS (SELECT 1 FROM dbo.TaskLabels WHERE Code = N'ready_accept')
    INSERT INTO dbo.TaskLabels (Code, Name, ColorHex, SortOrder) VALUES (N'ready_accept', N'Готово к приемке', N'#43A047', 30);
GO

-- Добавляем ссылку на метку в Tasks (1 метка на задачу, необязательно)
IF COL_LENGTH('dbo.Tasks', 'LabelId') IS NULL
    ALTER TABLE dbo.Tasks ADD LabelId INT NULL;
GO

-- FK на справочник меток (если ещё нет)
IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Tasks_TaskLabels_LabelId'
)
BEGIN
    ALTER TABLE dbo.Tasks WITH NOCHECK
      ADD CONSTRAINT FK_Tasks_TaskLabels_LabelId
      FOREIGN KEY (LabelId) REFERENCES dbo.TaskLabels(LabelId);
END;
GO

-- Индекс для быстрого фильтра по меткам
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Tasks_LabelId' AND object_id = OBJECT_ID(N'dbo.Tasks'))
    CREATE NONCLUSTERED INDEX IX_Tasks_LabelId ON dbo.Tasks(LabelId);
GO


------------------------------------------------------------
-- 2) ПЕЧАТЬ НАРЯДА + QR (ПУБЛИЧНЫЙ КОД И ЖУРНАЛ ПЕЧАТЕЙ)
------------------------------------------------------------
-- Публичный код и дата последней печати в задачах
IF COL_LENGTH('dbo.Tasks', 'PublicCode') IS NULL
    ALTER TABLE dbo.Tasks ADD PublicCode NVARCHAR(16) NULL;  -- напр. 'T-25-00123'
GO

-- Уникальный индекс на публичный код
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Tasks_PublicCode' AND object_id = OBJECT_ID(N'dbo.Tasks'))
    CREATE UNIQUE INDEX UX_Tasks_PublicCode ON dbo.Tasks(PublicCode) WHERE PublicCode IS NOT NULL;
GO

IF COL_LENGTH('dbo.Tasks', 'LastPrintedAt') IS NULL
    ALTER TABLE dbo.Tasks ADD LastPrintedAt DATETIME2(3) NULL;
GO

-- Опциональный журнал печати
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[TaskPrintLogs]') AND type = N'U')
BEGIN
    CREATE TABLE dbo.TaskPrintLogs (
        LogId            INT IDENTITY(1,1) PRIMARY KEY,
        TaskId           INT           NOT NULL,
        PrintedByUserId  INT           NOT NULL,
        PrintedAt        DATETIME2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
        TemplateName     NVARCHAR(40)  NULL
    );

    ALTER TABLE dbo.TaskPrintLogs  WITH CHECK
        ADD CONSTRAINT FK_TaskPrintLogs_Tasks
        FOREIGN KEY (TaskId) REFERENCES dbo.Tasks(TaskId);

    ALTER TABLE dbo.TaskPrintLogs  WITH CHECK
        ADD CONSTRAINT FK_TaskPrintLogs_Users
        FOREIGN KEY (PrintedByUserId) REFERENCES dbo.Users(UserId);

    CREATE NONCLUSTERED INDEX IX_TaskPrintLogs_TaskId ON dbo.TaskPrintLogs(TaskId, PrintedAt DESC);
END;
GO


------------------------------------------------------------
-- 3) ЗАЯВКИ НА МАТЕРИАЛЫ (СПРАВОЧНИК + КОНТУР ЗАЯВОК)
------------------------------------------------------------
-- Справочник материалов
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[MaterialCatalog]') AND type = N'U')
BEGIN
    CREATE TABLE dbo.MaterialCatalog (
        MaterialId  INT IDENTITY(1,1) PRIMARY KEY,
        Name        NVARCHAR(200) NOT NULL,
        Unit        NVARCHAR(20)  NULL,         -- 'шт','меш','м','кг','м2' и т.д.
        Code        NVARCHAR(50)  NULL,         -- внутренний артикул
        IsActive    BIT           NOT NULL DEFAULT(1),
        CreatedAt   DATETIME2(3)  NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE NONCLUSTERED INDEX IX_MaterialCatalog_IsActive ON dbo.MaterialCatalog(IsActive, Name);
END;
GO

-- Первичное наполнение материалов (примерно; правь под себя)
IF NOT EXISTS (SELECT 1 FROM dbo.MaterialCatalog)
BEGIN
    INSERT INTO dbo.MaterialCatalog (Name, Unit, Code) VALUES
        (N'Цемент М500 (мешок 50 кг)', N'меш', N'CEM-M500-50'),
        (N'Саморез 4.2×25 по металлу', N'шт',  N'SZ-4.2x25'),
        (N'Дюбель для теплоизоляции 10×110', N'шт', N'DB-10x110'),
        (N'Перчатки х/б с ПВХ', N'пара', N'GLO-PVC'),
        (N'Пленка ПВД 80 мкм', N'м2', N'PL-80');
END;
GO

-- Шапка заявки
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[MaterialRequests]') AND type = N'U')
BEGIN
    CREATE TABLE dbo.MaterialRequests (
        RequestId        INT IDENTITY(1,1) PRIMARY KEY,
        TaskId           INT           NOT NULL,
        CreatedByUserId  INT           NOT NULL,
        CreatedAt        DATETIME2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
        RequiredDate     DATE          NULL,
        Status           NVARCHAR(20)  NOT NULL DEFAULT N'Draft', 
        Comment          NVARCHAR(400) NULL
            -- Разрешенные статусы: Draft, Submitted, Approved, Issued, Delivered, Closed, Rejected
    );

    ALTER TABLE dbo.MaterialRequests  WITH CHECK
        ADD CONSTRAINT FK_MaterialRequests_Tasks
        FOREIGN KEY (TaskId) REFERENCES dbo.Tasks(TaskId);

    ALTER TABLE dbo.MaterialRequests  WITH CHECK
        ADD CONSTRAINT FK_MaterialRequests_Users
        FOREIGN KEY (CreatedByUserId) REFERENCES dbo.Users(UserId);

    -- Чек-constraint на статусы
    ALTER TABLE dbo.MaterialRequests WITH CHECK
        ADD CONSTRAINT CK_MaterialRequests_Status
        CHECK (Status IN (N'Draft', N'Submitted', N'Approved', N'Issued', N'Delivered', N'Closed', N'Rejected'));

    CREATE NONCLUSTERED INDEX IX_MaterialRequests_TaskId ON dbo.MaterialRequests(TaskId);
    CREATE NONCLUSTERED INDEX IX_MaterialRequests_Status ON dbo.MaterialRequests(Status, RequiredDate);
END;
GO

-- Позиции заявки
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[MaterialRequestItems]') AND type = N'U')
BEGIN
    CREATE TABLE dbo.MaterialRequestItems (
        RequestItemId  INT IDENTITY(1,1) PRIMARY KEY,
        RequestId      INT           NOT NULL,
        MaterialId     INT           NOT NULL,
        Qty            DECIMAL(18,3) NOT NULL,
        Comment        NVARCHAR(400) NULL
    );

    ALTER TABLE dbo.MaterialRequestItems  WITH CHECK
        ADD CONSTRAINT FK_MaterialRequestItems_Requests
        FOREIGN KEY (RequestId) REFERENCES dbo.MaterialRequests(RequestId) ON DELETE CASCADE;

    ALTER TABLE dbo.MaterialRequestItems  WITH CHECK
        ADD CONSTRAINT FK_MaterialRequestItems_Material
        FOREIGN KEY (MaterialId) REFERENCES dbo.MaterialCatalog(MaterialId);

    ALTER TABLE dbo.MaterialRequestItems  WITH CHECK
        ADD CONSTRAINT CK_MaterialRequestItems_Qty_Positive
        CHECK (Qty > 0);

    CREATE NONCLUSTERED INDEX IX_MaterialRequestItems_RequestId ON dbo.MaterialRequestItems(RequestId);
END;
GO

-- Лог смен статусов заявки (аудит)
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[MaterialRequestStatusLog]') AND type = N'U')
BEGIN
    CREATE TABLE dbo.MaterialRequestStatusLog (
        LogId           INT IDENTITY(1,1) PRIMARY KEY,
        RequestId       INT           NOT NULL,
        OldStatus       NVARCHAR(20)  NULL,
        NewStatus       NVARCHAR(20)  NOT NULL,
        ChangedByUserId INT           NOT NULL,
        ChangedAt       DATETIME2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
        Comment         NVARCHAR(400) NULL
    );

    ALTER TABLE dbo.MaterialRequestStatusLog  WITH CHECK
        ADD CONSTRAINT FK_MaterialRequestStatusLog_Request
        FOREIGN KEY (RequestId) REFERENCES dbo.MaterialRequests(RequestId) ON DELETE CASCADE;

    ALTER TABLE dbo.MaterialRequestStatusLog  WITH CHECK
        ADD CONSTRAINT FK_MaterialRequestStatusLog_User
        FOREIGN KEY (ChangedByUserId) REFERENCES dbo.Users(UserId);

    ALTER TABLE dbo.MaterialRequestStatusLog WITH CHECK
        ADD CONSTRAINT CK_MaterialRequestStatusLog_Status
        CHECK (NewStatus IN (N'Draft', N'Submitted', N'Approved', N'Issued', N'Delivered', N'Closed', N'Rejected'));

    CREATE NONCLUSTERED INDEX IX_MaterialRequestStatusLog_RequestId ON dbo.MaterialRequestStatusLog(RequestId, ChangedAt DESC);
END;
GO

-- Документы/этапы выдачи-доставки (опционально)
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[MaterialDeliveryDocs]') AND type = N'U')
BEGIN
    CREATE TABLE dbo.MaterialDeliveryDocs (
        DeliveryId   INT IDENTITY(1,1) PRIMARY KEY,
        RequestId    INT           NOT NULL,
        Event        NVARCHAR(20)  NOT NULL,          -- 'Issued' / 'Delivered'
        EventAt      DATETIME2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
        DocNumber    NVARCHAR(50)  NULL,
        Note         NVARCHAR(400) NULL
    );

    ALTER TABLE dbo.MaterialDeliveryDocs  WITH CHECK
        ADD CONSTRAINT FK_MaterialDeliveryDocs_Request
        FOREIGN KEY (RequestId) REFERENCES dbo.MaterialRequests(RequestId) ON DELETE CASCADE;

    ALTER TABLE dbo.MaterialDeliveryDocs WITH CHECK
        ADD CONSTRAINT CK_MaterialDeliveryDocs_Event
        CHECK (Event IN (N'Issued', N'Delivered'));

    CREATE NONCLUSTERED INDEX IX_MaterialDeliveryDocs_RequestId ON dbo.MaterialDeliveryDocs(RequestId, EventAt DESC);
END;
GO


------------------------------------------------------------
-- 3.1) ДЕМО-ДАННЫЕ: пример одной заявки (если есть Tasks и Users)
------------------------------------------------------------
DECLARE @AnyTaskId INT = (SELECT TOP (1) TaskId FROM dbo.Tasks ORDER BY TaskId);
DECLARE @AnyUserId INT = (SELECT TOP (1) UserId FROM dbo.Users ORDER BY UserId);

/* ДЕМО-СОЗДАНИЕ ОДНОЙ ЗАЯВКИ НА МАТЕРИАЛЫ
   Запускай после создания таблиц. Не вставляй GO внутри. */
BEGIN
    DECLARE 
        @AnyTaskId  INT,
        @AnyUserId  INT,
        @NewReqId   INT,
        @Mat1       INT,
        @Mat2       INT;

    -- Берём любую задачу и любого пользователя
    SELECT TOP (1) @AnyTaskId = TaskId FROM dbo.Tasks ORDER BY TaskId;
    SELECT TOP (1) @AnyUserId = UserId FROM dbo.Users ORDER BY UserId;

    IF @AnyTaskId IS NOT NULL AND @AnyUserId IS NOT NULL
    BEGIN
        -- Если на эту задачу ещё нет демо-заявки в статусе Draft — создаём
        IF NOT EXISTS (
            SELECT 1 FROM dbo.MaterialRequests
            WHERE TaskId = @AnyTaskId AND Status = N'Draft'
        )
        BEGIN
            INSERT INTO dbo.MaterialRequests
                (TaskId, CreatedByUserId, RequiredDate, Status, Comment)
            VALUES
                (@AnyTaskId, @AnyUserId, CONVERT(date, DATEADD(day, 2, SYSUTCDATETIME())),
                 N'Draft', N'Демо-заявка: для проверки контура');

            SET @NewReqId = SCOPE_IDENTITY();

            -- Две позиции из каталога
            SELECT TOP(1) @Mat1 = MaterialId FROM dbo.MaterialCatalog WHERE IsActive = 1 ORDER BY MaterialId;
            SELECT TOP(1) @Mat2 = MaterialId FROM dbo.MaterialCatalog WHERE IsActive = 1 ORDER BY MaterialId DESC;

            IF @Mat1 IS NOT NULL
                INSERT INTO dbo.MaterialRequestItems (RequestId, MaterialId, Qty, Comment)
                VALUES (@NewReqId, @Mat1, 10, N'На объект А');

            IF @Mat2 IS NOT NULL AND @Mat2 <> @Mat1
                INSERT INTO dbo.MaterialRequestItems (RequestId, MaterialId, Qty, Comment)
                VALUES (@NewReqId, @Mat2, 5, N'На объект А');

            INSERT INTO dbo.MaterialRequestStatusLog
                (RequestId, OldStatus, NewStatus, ChangedByUserId, Comment)
            VALUES
                (@NewReqId, NULL, N'Draft', @AnyUserId, N'Создана демо-заявка');
        END
    END
    ELSE
        PRINT N'Пропущено создание демо-заявки: нет записей в Tasks или Users.';
END;


USE [BrigadePlanner];
GO

SET NOCOUNT ON;
GO

---------------------------------------------------------------
-- 1. Проверяем / создаём роли
---------------------------------------------------------------
IF OBJECT_ID('dbo.Roles','U') IS NULL
BEGIN
    CREATE TABLE dbo.Roles(
        RoleId   TINYINT      NOT NULL PRIMARY KEY,
        RoleName NVARCHAR(50) NOT NULL UNIQUE
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE RoleId = 1)
    INSERT INTO dbo.Roles(RoleId, RoleName) VALUES (1, N'Администратор');

IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE RoleId = 2)
    INSERT INTO dbo.Roles(RoleId, RoleName) VALUES (2, N'Диспетчер');

IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE RoleId = 3)
    INSERT INTO dbo.Roles(RoleId, RoleName) VALUES (3, N'Бригадир');
GO

---------------------------------------------------------------
-- 2. Добавляем RoleId в Users, если его ещё нет
---------------------------------------------------------------
IF COL_LENGTH('dbo.Users', 'RoleId') IS NULL
BEGIN
    ALTER TABLE dbo.Users
    ADD RoleId TINYINT NULL;
END;
GO

---------------------------------------------------------------
-- 3. Если есть UserRoles — переносим роли оттуда в Users
--    Если у пользователя несколько ролей, берём MIN(RoleId)
---------------------------------------------------------------
IF OBJECT_ID('dbo.UserRoles','U') IS NOT NULL
BEGIN
    ;WITH UserRoleSingle AS
    (
        SELECT 
            UserId,
            MIN(RoleId) AS RoleId
        FROM dbo.UserRoles
        GROUP BY UserId
    )
    UPDATE u
    SET u.RoleId = urs.RoleId
    FROM dbo.Users u
    INNER JOIN UserRoleSingle urs ON u.UserId = urs.UserId
    WHERE u.RoleId IS NULL;
END;
GO

---------------------------------------------------------------
-- 4. Для учебных пользователей проставляем роли по логинам
---------------------------------------------------------------
UPDATE dbo.Users
SET RoleId = 1
WHERE LoginName = N'1' AND RoleId IS NULL;

UPDATE dbo.Users
SET RoleId = 2
WHERE LoginName = N'2' AND RoleId IS NULL;

UPDATE dbo.Users
SET RoleId = 3
WHERE LoginName = N'3' AND RoleId IS NULL;
GO

---------------------------------------------------------------
-- 5. Всем остальным без роли временно ставим "Диспетчер"
---------------------------------------------------------------
UPDATE dbo.Users
SET RoleId = 2
WHERE RoleId IS NULL;
GO

---------------------------------------------------------------
-- 6. Удаляем старый внешний ключ, если уже был
---------------------------------------------------------------
IF EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = N'FK_Users_Roles'
)
BEGIN
    ALTER TABLE dbo.Users DROP CONSTRAINT FK_Users_Roles;
END;
GO

---------------------------------------------------------------
-- 7. Делаем RoleId обязательным
---------------------------------------------------------------
ALTER TABLE dbo.Users
ALTER COLUMN RoleId TINYINT NOT NULL;
GO

---------------------------------------------------------------
-- 8. Добавляем новый внешний ключ Users -> Roles
---------------------------------------------------------------
ALTER TABLE dbo.Users
ADD CONSTRAINT FK_Users_Roles
FOREIGN KEY (RoleId) REFERENCES dbo.Roles(RoleId);
GO

---------------------------------------------------------------
-- 9. Удаляем таблицу UserRoles, она больше не нужна
---------------------------------------------------------------
IF OBJECT_ID('dbo.UserRoles','U') IS NOT NULL
    DROP TABLE dbo.UserRoles;
GO

---------------------------------------------------------------
-- 10. Проверка результата
---------------------------------------------------------------
SELECT 
    u.UserId,
    u.LoginName,
    u.FullName,
    u.RoleId,
    r.RoleName
FROM dbo.Users u
INNER JOIN dbo.Roles r ON r.RoleId = u.RoleId
ORDER BY u.UserId;
GO

PRINT N'Готово: таблица UserRoles удалена, связь Users -> Roles настроена.';
GO