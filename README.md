
# React Node 3-Tier User Management App

This is a full-stack application for managing users with a front-end built using HTML, CSS, and JavaScript, and a back-end powered by Node.js, Express, and MySQL.

## Database Configuration

`server/config/db.js`

## Complete README

Please see the [README.md](https://github.com/ibtisamops/3TierUserApp-ReactNode-MySQL/blob/main/README.md) file for a detailed description of the project.

## Docker Compose

This project actually follows 3-Tier Architecture. However, for practice, I just combined the front-end and back-end into one container. To see its 3-Tier Architecture Docker Compose Deployment, please refer [here](https://github.com/ibtisamops/3TierUserApp-ReactNode-MySQL).

In this setup, there is no Nginx, Express is responsible for:

- ✅ Serving API routes (e.g., /api/users)
- ✅ Handling API requests (receiving requests from frontend, responding directly)
- ✅ Managing database interactions (e.g., CRUD operations)
- ✅ Serving static files (e.g., index.html)
- ✅ Handling errors and exceptions
- ✅ Running the server

```bash
ibtisam@mint-dell:/media/ibtisam/L-Mint/git/Projects/2TierUserApp-ReactNode-MySQL$ docker compose up -d --build
[+] Building 55.0s (17/17) FINISHED                                                                                                                 docker:desktop-linux
 => [server internal] load build definition from Dockerfile                                                                                                         0.2s
 => => transferring dockerfile: 1.01kB                                                                                                                              0.0s
 => [server internal] load metadata for docker.io/library/node:18-alpine                                                                                            6.2s
 => [server auth] library/node:pull token for registry-1.docker.io                                                                                                  0.0s
 => [server internal] load .dockerignore                                                                                                                            0.2s
 => => transferring context: 47B                                                                                                                                    0.0s
 => CACHED [server  1/11] FROM docker.io/library/node:18-alpine@sha256:974afb6cbc0314dc6502b14243b8a39fbb2d04d975e9059dd066be3e274fbb25                             0.0s
 => [server internal] load build context                                                                                                                            0.5s
 => => transferring context: 563.45kB                                                                                                                               0.1s
 => [server  2/11] WORKDIR /usr/src/app/client                                                                                                                      1.9s
 => [server  3/11] COPY client/package*.json ./                                                                                                                     1.7s
 => [server  4/11] RUN npm install --include=dev                                                                                                                   16.7s
 => [server  5/11] COPY client/ ./                                                                                                                                  1.3s 
 => [server  6/11] RUN npm run build                                                                                                                                6.0s 
 => [server  7/11] WORKDIR /usr/src/app/server                                                                                                                      1.2s 
 => [server  8/11] COPY server/package*.json ./                                                                                                                     1.1s 
 => [server  9/11] RUN npm ci --omit=dev                                                                                                                            6.5s 
 => [server 10/11] COPY server/ ./                                                                                                                                  1.3s 
 => [server 11/11] RUN mkdir -p ./public && cp -R /usr/src/app/client/public/* ./public/                                                                            2.2s 
 => [server] exporting to image                                                                                                                                     6.4s 
 => => exporting layers                                                                                                                                             5.9s 
 => => writing image sha256:b9ce5bf15d200a71d2d6061366575ee315fe0b63df62fbc6df5fee960311a39a                                                                        0.1s
 => => naming to docker.io/library/1-single-backend-container-serves-both-the-api-and-static-frontend-files                                                         0.1s
[+] Running 4/4
 ✔ Network 2tieruserapp-reactnode-mysql_app-network     Created                                                                                                     0.4s 
 ✔ Volume "2tieruserapp-reactnode-mysql_db_data_2Tier"  Created                                                                                                     0.1s 
 ✔ Container mysql                                      Healthy                                                                                                    96.9s 
 ✔ Container server                                     Started                                                                                                    95.1s 
ibtisam@mint-dell:/media/ibtisam/L-Mint/git/Projects/2TierUserApp-ReactNode-MySQL$ docker images
REPOSITORY                                                                             TAG                  IMAGE ID       CREATED         SIZE
1-single-backend-container-serves-both-the-api-and-static-frontend-files               latest               b9ce5bf15d20   5 minutes ago   187MB
```


## Project Snapshot
![Project Snapshot](./images/projectSnapshot.png)

![API is working](./images/API%20is%20working.png)
