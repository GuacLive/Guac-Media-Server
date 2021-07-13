# Multi-stage builds require Docker 17.05 or higher on the daemon and client.

FROM jrottenberg/ffmpeg:4.0-scratch as ffmpeg
FROM node:12.14.1-alpine

COPY --from=ffmpeg / /

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm i

COPY . .

EXPOSE 1935 8000 8443

CMD ["node", "misc/index.js"]
