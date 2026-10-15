// Demo inputs only. These fill the log editor; the model always performs the analysis.
// All names, paths, and credentials are fictional.

export interface ExampleLog {
  id: string;
  label: string;
  description: string;
  log: string;
}

const npmEresolve = String.raw`$ node -v
v22.11.0
$ npm -v
10.9.0
$ cat package.json
{
  "name": "invoice-dashboard",
  "version": "0.3.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "test": "vitest"
  },
  "dependencies": {
    "@emotion/react": "^11.13.3",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.1",
    "vite": "^5.4.8",
    "vitest": "^2.1.2"
  }
}
$ npm install --save-dev @testing-library/react-hooks
npm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory.
npm error code ERESOLVE
npm error ERESOLVE unable to resolve dependency tree
npm error
npm error While resolving: invoice-dashboard@0.3.0
npm error Found: react@18.3.1
npm error node_modules/react
npm error   react@"^18.3.1" from the root project
npm error   peer react@">=16.8.0" from @emotion/react@11.13.3
npm error   node_modules/@emotion/react
npm error     @emotion/react@"^11.13.3" from the root project
npm error
npm error Could not resolve dependency:
npm error peer react@"^16.9.0 || ^17.0.0" from @testing-library/react-hooks@8.0.1
npm error node_modules/@testing-library/react-hooks
npm error   dev @testing-library/react-hooks@"*" from the root project
npm error
npm error Fix the upstream dependency conflict, or retry
npm error this command with --force or --legacy-peer-deps
npm error to accept an incorrect (and potentially broken) dependency resolution.
npm error
npm error
npm error For a full report see:
npm error /home/dev/.npm/_logs/2026-10-15T09_12_44_118Z-eresolve-report.txt
npm error A complete log of this run can be found in: /home/dev/.npm/_logs/2026-10-15T09_12_44_118Z-debug-0.log`;

const pythonModuleNotFound = String.raw`$ cd ~/projects/receipt-bot
$ python3 -m venv .venv
$ pip install python-dotenv requests
Defaulting to user installation because normal site-packages is not writeable
Requirement already satisfied: python-dotenv in /home/dev/.local/lib/python3.12/site-packages (1.0.1)
Requirement already satisfied: requests in /usr/lib/python3/dist-packages (2.31.0)
Requirement already satisfied: charset-normalizer<4,>=2 in /usr/lib/python3/dist-packages (from requests) (3.3.2)
Requirement already satisfied: idna<4,>=2.5 in /usr/lib/python3/dist-packages (from requests) (3.6)
Requirement already satisfied: urllib3<3,>=1.21.1 in /usr/lib/python3/dist-packages (from requests) (2.0.7)
$ source .venv/bin/activate
(.venv) $ python app.py
Traceback (most recent call last):
  File "/home/dev/projects/receipt-bot/app.py", line 3, in <module>
    from dotenv import load_dotenv
ModuleNotFoundError: No module named 'dotenv'
(.venv) $ which python
/home/dev/projects/receipt-bot/.venv/bin/python
(.venv) $ pip --version
pip 24.0 from /home/dev/projects/receipt-bot/.venv/lib/python3.12/site-packages/pip (python 3.12)
(.venv) $ pip list
Package Version
------- -------
pip     24.0`;

const dockerStartup = String.raw`$ cat docker-compose.yml
services:
  api:
    build: .
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: postgres://app:SuperSecret123@localhost:5432/shop
    depends_on:
      - db
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: SuperSecret123
      POSTGRES_DB: shop
$ docker compose up
[+] Running 3/3
 ✔ Network shop_default  Created
 ✔ Container shop-db-1   Created
 ✔ Container shop-api-1  Created
Attaching to api-1, db-1
db-1   | The files belonging to this database system will be owned by user "postgres".
db-1   | This user must also own the server process.
db-1   | initdb: warning: enabling "trust" authentication for local connections
api-1  |
api-1  | > shop-api@1.4.0 start
api-1  | > node dist/server.js
api-1  |
api-1  | [config] NODE_ENV=production PORT=8080
api-1  | [config] DATABASE_URL=postgres://app:SuperSecret123@localhost:5432/shop
api-1  | [db] connecting...
api-1  | Error: connect ECONNREFUSED 127.0.0.1:5432
api-1  |     at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1611:16) {
api-1  |   errno: -111,
api-1  |   code: 'ECONNREFUSED',
api-1  |   syscall: 'connect',
api-1  |   address: '127.0.0.1',
api-1  |   port: 5432
api-1  | }
api-1  |
api-1  | Node.js v22.11.0
api-1 exited with code 1
db-1   | 2026-10-15 14:02:10.917 UTC [1] LOG:  starting PostgreSQL 16.4 on x86_64-pc-linux-musl
db-1   | 2026-10-15 14:02:10.918 UTC [1] LOG:  listening on IPv4 address "0.0.0.0", port 5432
db-1   | 2026-10-15 14:02:11.482 UTC [1] LOG:  database system is ready to accept connections`;

export const EXAMPLE_LOGS: ExampleLog[] = [
  {
    id: "npm-eresolve",
    label: "npm ERESOLVE",
    description: "Peer-dependency conflict while installing a dev dependency",
    log: npmEresolve,
  },
  {
    id: "python-modulenotfound",
    label: "Python ModuleNotFoundError",
    description: "Package installed, but the app still can't import it",
    log: pythonModuleNotFound,
  },
  {
    id: "docker-startup",
    label: "Docker startup failure",
    description: "API container exits right after docker compose up",
    log: dockerStartup,
  },
];
