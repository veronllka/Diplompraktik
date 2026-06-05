# BotHost deployment

Deploy this folder (`bothost-miniapp`) as the BotHost repository root.

BotHost project settings:

```text
Library/language: Node.js
Startup file: app.js
Branch: main
```

If the runtime log shows `SyntaxError: invalid syntax` on `const http = require('http')`,
the project is running as Python. Switch the BotHost library/language to Node.js
and redeploy the same `main` branch.

Required BotHost environment variables:

```text
PORT=7777
```

No SQL Server variables are required.

The Mini App contains its own server API and creates the database automatically
on first startup:

```text
data/brigadeplanner-db.json
```

This file is created on the server, not in GitHub. It stores the server-side
data used by Mini App, Android, and WPF through:

```text
https://bdzahitadiploma.bothost.tech/api
```

Starter application users are created automatically:

```text
1 / 1 - Администратор
2 / 2 - Диспетчер
3 / 3 - Бригадир
```

Optional variables:

```text
DATA_DIR=/path/to/persistent/data
DB_FILE=/path/to/persistent/brigadeplanner-db.json
JWT_SECRET=<random-secret-for-api-tokens>
```

Use optional paths only if BotHost gives a separate persistent storage folder.
