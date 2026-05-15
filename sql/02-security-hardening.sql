/*
    Run on the SQL Server that hosts BrigadePlanner.
    This keeps the database private: clients use only HTTPS API, and only the API login can access DB.

    Replace passwords/certificate names before production.
*/

USE master;
GO

IF NOT EXISTS (SELECT 1 FROM sys.symmetric_keys WHERE name = '##MS_DatabaseMasterKey##')
BEGIN
    CREATE MASTER KEY ENCRYPTION BY PASSWORD = 'CHANGE_MASTER_KEY_PASSWORD';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.certificates WHERE name = 'BrigadePlannerTdeCert')
BEGIN
    CREATE CERTIFICATE BrigadePlannerTdeCert
    WITH SUBJECT = 'BrigadePlanner TDE certificate';
END
GO

USE BrigadePlanner;
GO

IF NOT EXISTS (SELECT 1 FROM sys.dm_database_encryption_keys WHERE database_id = DB_ID())
BEGIN
    CREATE DATABASE ENCRYPTION KEY
    WITH ALGORITHM = AES_256
    ENCRYPTION BY SERVER CERTIFICATE BrigadePlannerTdeCert;
END
GO

ALTER DATABASE BrigadePlanner SET ENCRYPTION ON;
GO

IF COL_LENGTH('dbo.Users', 'PasswordHash') IS NULL
    ALTER TABLE dbo.Users ADD PasswordHash NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.Users', 'PasswordSalt') IS NULL
    ALTER TABLE dbo.Users ADD PasswordSalt NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.Users', 'PasswordIterations') IS NULL
    ALTER TABLE dbo.Users ADD PasswordIterations INT NULL;
IF COL_LENGTH('dbo.Users', 'TelegramId') IS NULL
    ALTER TABLE dbo.Users ADD TelegramId BIGINT NULL;
GO

USE master;
GO

IF NOT EXISTS (SELECT 1 FROM sys.sql_logins WHERE name = 'brigadeplanner_api')
BEGIN
    CREATE LOGIN brigadeplanner_api WITH PASSWORD = 'CHANGE_API_DB_PASSWORD', CHECK_POLICY = ON, CHECK_EXPIRATION = ON;
END
GO

USE BrigadePlanner;
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'brigadeplanner_api')
BEGIN
    CREATE USER brigadeplanner_api FOR LOGIN brigadeplanner_api;
END
GO

ALTER ROLE db_datareader ADD MEMBER brigadeplanner_api;
ALTER ROLE db_datawriter ADD MEMBER brigadeplanner_api;
GO

-- The API needs schema migration rights only while first deployment/migration runs.
-- After migrations, revoke these rights:
-- ALTER ROLE db_ddladmin DROP MEMBER brigadeplanner_api;
ALTER ROLE db_ddladmin ADD MEMBER brigadeplanner_api;
GO

/*
    Production connection string example:
    Server=tcp:<private-db-host>,1433;Database=BrigadePlanner;User ID=brigadeplanner_api;Password=<secret>;Encrypt=True;TrustServerCertificate=False;MultipleActiveResultSets=True;

    Store it as an environment variable:
    ConnectionStrings__BrigadePlanner=<connection-string>

    Store JWT and Telegram secrets as environment variables:
    Jwt__SigningKey=<64+ random chars>
    Telegram__BotToken=<BotFather token>
*/
