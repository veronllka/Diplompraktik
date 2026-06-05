# BotHost deployment

Deploy this folder (`bothost-miniapp`) as the BotHost repository root.

BotHost project settings:

```text
Library/language: Node.js
Startup file: app.js
Branch: main
```

`http-wrapper.js` is included only as a compatibility entry point. If BotHost
tries to run `/app/http-wrapper.js` from an old or internal startup command, it
starts the same server as `app.js`.

If the runtime log shows `SyntaxError: invalid syntax` on `const http = require('http')`,
the project is running as Python. Switch the BotHost library/language to Node.js
and redeploy the same `main` branch.

BotHost environment variables:

```text
PORT=<set only if BotHost provides/requires a custom port>
```

By default the app follows the BotHost manual and listens on `3000` when
`PORT` is not set.

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
