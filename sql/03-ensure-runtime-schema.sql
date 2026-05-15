SET NOCOUNT ON;
GO

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

IF OBJECT_ID('dbo.Users','U') IS NULL
BEGIN
    THROW 51000, 'dbo.Users table is missing. Run sql/01-init-server-db.sql on an empty database first.', 1;
END;
GO

IF COL_LENGTH('dbo.Users', 'RoleId') IS NULL
    ALTER TABLE dbo.Users ADD RoleId TINYINT NULL;
IF COL_LENGTH('dbo.Users', 'PasswordHash') IS NULL
    ALTER TABLE dbo.Users ADD PasswordHash NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.Users', 'PasswordSalt') IS NULL
    ALTER TABLE dbo.Users ADD PasswordSalt NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.Users', 'PasswordIterations') IS NULL
    ALTER TABLE dbo.Users ADD PasswordIterations INT NULL;
IF COL_LENGTH('dbo.Users', 'TelegramId') IS NULL
    ALTER TABLE dbo.Users ADD TelegramId BIGINT NULL;
IF COL_LENGTH('dbo.Users', 'PreferredTheme') IS NULL
    ALTER TABLE dbo.Users ADD PreferredTheme NVARCHAR(20) NULL;
IF COL_LENGTH('dbo.Users', 'AccentColor') IS NULL
    ALTER TABLE dbo.Users ADD AccentColor NVARCHAR(20) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE LoginName = N'1')
    INSERT INTO dbo.Users(LoginName, PasswordPlain, FullName, RoleId, IsActive, CreatedAt, PreferredTheme, AccentColor)
    VALUES (N'1', N'1', N'Администратор', 1, 1, SYSUTCDATETIME(), 'Light', 'Brown');
IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE LoginName = N'2')
    INSERT INTO dbo.Users(LoginName, PasswordPlain, FullName, RoleId, IsActive, CreatedAt, PreferredTheme, AccentColor)
    VALUES (N'2', N'2', N'Диспетчер', 2, 1, SYSUTCDATETIME(), 'Light', 'Brown');
IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE LoginName = N'3')
    INSERT INTO dbo.Users(LoginName, PasswordPlain, FullName, RoleId, IsActive, CreatedAt, PreferredTheme, AccentColor)
    VALUES (N'3', N'3', N'Бригадир', 3, 1, SYSUTCDATETIME(), 'Light', 'Brown');
GO

UPDATE dbo.Users
SET RoleId = CASE LoginName WHEN N'1' THEN 1 WHEN N'2' THEN 2 WHEN N'3' THEN 3 ELSE RoleId END,
    IsActive = 1,
    PreferredTheme = COALESCE(NULLIF(PreferredTheme, ''), 'Light'),
    AccentColor = COALESCE(NULLIF(AccentColor, ''), 'Brown')
WHERE LoginName IN (N'1', N'2', N'3');
GO

IF OBJECT_ID('dbo.RolePermissions','U') IS NULL
BEGIN
    CREATE TABLE dbo.RolePermissions(
        RoleId         TINYINT       NOT NULL,
        PermissionCode NVARCHAR(100) NOT NULL,
        CONSTRAINT PK_RolePermissions PRIMARY KEY(RoleId, PermissionCode),
        CONSTRAINT FK_RolePermissions_Roles FOREIGN KEY(RoleId) REFERENCES dbo.Roles(RoleId) ON DELETE CASCADE
    );
END;
GO

IF OBJECT_ID('dbo.DailyPlans','U') IS NULL
BEGIN
    CREATE TABLE dbo.DailyPlans(
        PlanId          INT IDENTITY(1,1) PRIMARY KEY,
        PlanDate        DATE          NOT NULL UNIQUE,
        CreatedByUserId INT           NOT NULL,
        CreatedAt       DATETIME2(3)  NOT NULL CONSTRAINT DF_DailyPlans_CreatedAt DEFAULT (SYSUTCDATETIME()),
        Comment         NVARCHAR(MAX) NULL,
        Status          NVARCHAR(50)  NOT NULL CONSTRAINT DF_DailyPlans_Status DEFAULT (N'Черновик'),
        CONSTRAINT FK_DailyPlans_Users FOREIGN KEY(CreatedByUserId) REFERENCES dbo.Users(UserId)
    );
END;
GO

IF OBJECT_ID('dbo.DailyPlanItems','U') IS NULL
BEGIN
    CREATE TABLE dbo.DailyPlanItems(
        PlanItemId     INT IDENTITY(1,1) PRIMARY KEY,
        PlanId         INT           NOT NULL,
        TaskId         INT           NOT NULL,
        CrewId         INT           NOT NULL,
        SortOrder      INT           NOT NULL CONSTRAINT DF_DailyPlanItems_SortOrder DEFAULT (0),
        Note           NVARCHAR(MAX) NULL,
        MaterialsReady BIT           NOT NULL CONSTRAINT DF_DailyPlanItems_MaterialsReady DEFAULT (0),
        CONSTRAINT FK_DailyPlanItems_Plans FOREIGN KEY(PlanId) REFERENCES dbo.DailyPlans(PlanId) ON DELETE CASCADE,
        CONSTRAINT FK_DailyPlanItems_Tasks FOREIGN KEY(TaskId) REFERENCES dbo.Tasks(TaskId),
        CONSTRAINT FK_DailyPlanItems_Crews FOREIGN KEY(CrewId) REFERENCES dbo.Crews(CrewId)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_DailyPlanItems_PlanId' AND object_id = OBJECT_ID(N'dbo.DailyPlanItems'))
    CREATE NONCLUSTERED INDEX IX_DailyPlanItems_PlanId ON dbo.DailyPlanItems(PlanId, CrewId, SortOrder);
GO
