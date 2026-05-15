# BotHost deployment

Deploy this folder (`bothost-miniapp`) as the BotHost repository root.

Required BotHost environment variables:

```text
PORT=3000
API_PROXY_TARGET=http://127.0.0.1:5156
```

`API_PROXY_TARGET` must point to the private ASP.NET API. Public clients use only:

```text
https://bdzahitadiploma.bothost.tech/api
```

Before the first launch, initialize the server database:

1. Run `sql/01-init-server-db.sql` on SQL Server. It creates the `BrigadePlanner`
   database, all required tables, sample data, and starter users.
2. Run `sql/02-security-hardening.sql` after replacing placeholder passwords.
   This adds password-hash columns, Telegram binding columns, DB encryption setup,
   and the restricted `brigadeplanner_api` SQL login for the API.

Starter application users from `sql/01-init-server-db.sql`:

```text
1 / 1 - Администратор
2 / 2 - Диспетчер
3 / 3 - Бригадир
```

The database connection string, JWT key, and Telegram bot token must be configured on the ASP.NET API side:

```text
ConnectionStrings__BrigadePlanner=<private SQL Server connection string>
Jwt__SigningKey=<64+ random chars>
Telegram__BotToken=<BotFather token>
```

After creating `brigadeplanner_api`, the production connection string should use
that login instead of Windows trusted connection.
