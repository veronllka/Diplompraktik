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

The database connection string, JWT key, and Telegram bot token must be configured on the ASP.NET API side:

```text
ConnectionStrings__BrigadePlanner=<private SQL Server connection string>
Jwt__SigningKey=<64+ random chars>
Telegram__BotToken=<BotFather token>
```

Run `backend/BrigadePlanner.Api/sql/security-hardening.sql` on SQL Server before production launch.
