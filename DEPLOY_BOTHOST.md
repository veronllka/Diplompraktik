# BotHost deployment

Deploy this folder (`bothost-miniapp`) as the BotHost repository root.

Required BotHost environment variables:

```text
PORT=7777
API_PROXY_TARGET=http://127.0.0.1:5156
DB_AUTO_INIT=true
DB_PASSWORD=<SQL user password>
```

These database values are automatic by default:

```text
DB_HOST=localhost
DB_PORT=1433
DB_NAME=BrigadePlanner
DB_USER=brigadeplanner_api
```

Set them only if your SQL Server uses different values.

`API_PROXY_TARGET` must point to the private ASP.NET API. Public clients use only:

```text
https://bdzahitadiploma.bothost.tech/api
```

Before the first launch, create an empty SQL Server database named
`BrigadePlanner` and give the API login rights to create tables in it. The Mini
App server will initialize it automatically on startup when
`DB_PASSWORD` is configured:

1. If the database has no user tables, it runs `sql/01-init-server-db.sql`.
2. It always runs `sql/03-ensure-runtime-schema.sql` after that. This guarantees
   the starter users and runtime tables exist.

Starter application users after auto-initialization:

```text
1 / 1 - Администратор
2 / 2 - Диспетчер
3 / 3 - Бригадир
```

Manual fallback if auto-init is disabled:

1. Run `sql/01-init-server-db.sql` on SQL Server. It creates the `BrigadePlanner`
   database, all required tables, sample data, and starter users.
2. Run `sql/03-ensure-runtime-schema.sql` on the same database.
3. Run `sql/02-security-hardening.sql` after replacing placeholder passwords.
   This adds password-hash columns, Telegram binding columns, DB encryption setup,
   and the restricted `brigadeplanner_api` SQL login for the API.

The database connection string, JWT key, and Telegram bot token must be configured on the ASP.NET API side:

```text
ConnectionStrings__BrigadePlanner=<private SQL Server connection string>
Jwt__SigningKey=<64+ random chars>
Telegram__BotToken=<BotFather token>
```

`DB_CONNECTION_STRING` is still supported as an optional advanced override, but
the Mini App can work without it by using `DB_HOST`, `DB_NAME`, `DB_USER`, and
`DB_PASSWORD`.
