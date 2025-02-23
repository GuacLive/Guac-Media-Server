//
//  Created by Mingliang Chen on 17/8/1.
//  illuspas[a]gmail.com
//  Copyright (c) 2018 Nodemedia. All rights reserved.
//


const Fs = require('fs');
const path = require('path');
const Http = require('http');
const Https = require('https');
const WebSocket = require('ws');
const Express = require('express');
const bodyParser = require('body-parser');
const basicAuth = require('basic-auth-connect');
const NodeFlvSession = require('./node_flv_session');
const HTTP_PORT = 80;
const HTTP_HOST = '0.0.0.0';
const HTTPS_PORT = 443;
const HTTPS_HOST = '0.0.0.0';
const HTTP_MEDIAROOT = './media';
const HTTP_RECROOT = './rec';
const Logger = require('./node_core_logger');
const context = require('./node_core_ctx');

const misc = require('../misc/utils/helpers');

const streamsRoute = require('./api/routes/streams');
const serverRoute = require('./api/routes/server');
const relayRoute = require('./api/routes/relay');
const clipRoute = require('./api/routes/clip');

class NodeHttpServer {
  constructor(config) {
    this.port = config.http.port || HTTP_PORT;
    this.host = config.http.host || HTTP_HOST;
    this.mediaroot = config.http.mediaroot || HTTP_MEDIAROOT;
    this.recroot = config.http.recroot || HTTP_RECROOT;
    this.config = config;

    let app = Express();
    app.use(Express.json());

    app.use(Express.urlencoded({ extended: true }));

    app.all('*', (req, res, next) => {
      res.header('Access-Control-Allow-Origin', this.config.http.allow_origin);
      res.header('Access-Control-Allow-Headers', 'Content-Type,Content-Length, Authorization, Accept,X-Requested-With');
      res.header('Access-Control-Allow-Methods', 'PUT,POST,GET,DELETE,OPTIONS');
      res.header('Access-Control-Allow-Credentials', true);
      req.method === 'OPTIONS' ? res.sendStatus(200) : next();
    });

    app.get('*.flv', (req, res, next) => {
      req.nmsConnectionType = 'http';
      this.onConnect(req, res);
    });

    let adminEntry = path.join(__dirname + '/public/admin/index.html');
    if (Fs.existsSync(adminEntry)) {
      app.get('/admin/*', (req, res) => {
        res.sendFile(adminEntry);
      });
    }

    if (this.config.http.api !== false) {
      if (this.config.auth && this.config.auth.api) {
        app.use(['/api/*', '/static/*', '/admin/*'], basicAuth(this.config.auth.api_user, this.config.auth.api_pass));
      }
      app.use('/api/streams', streamsRoute(context));
      app.use('/api/server', serverRoute(context));
      app.use('/api/relay', relayRoute(context));
      app.use('/api/misc', misc.router(context));
      app.use('/api/clip', clipRoute(context));
    }

    app.use(Express.static(path.join(__dirname + '/public')));
    app.use(Express.static(this.mediaroot));
    app.use('/rec', Express.static(this.recroot));
    if (config.http.webroot) {
      app.use(Express.static(config.http.webroot));
    }

    this.httpServer = Http.createServer(app);

    /**
     * ~ openssl genrsa -out privatekey.pem 1024
     * ~ openssl req -new -key privatekey.pem -out certrequest.csr
     * ~ openssl x509 -req -in certrequest.csr -signkey privatekey.pem -out certificate.pem
     */
    if (this.config.https) {
      let options = {
        key: Fs.readFileSync(this.config.https.key),
        cert: Fs.readFileSync(this.config.https.cert)
      };
      this.sport = config.https.port ? config.https.port : HTTPS_PORT;
      this.shost = config.https.host ? config.https.host : HTTPS_HOST;
      this.httpsServer = Https.createServer(options, app);
    }
  }

  run() {
    this.httpServer.listen(this.port, this.host, () => {
      Logger.log(`Node Media Http Server started on: ${this.host}:${this.port}`);
    });

    this.httpServer.on('error', (e) => {
      Logger.error(`Node Media Http Server ${e}`);
    });

    this.httpServer.on('close', () => {
      Logger.log('Node Media Http Server Close.');
    });

    if (this.config.websocket) {
      this.wsServer = new WebSocket.Server({ server: this.httpServer });

      this.wsServer.on('connection', (ws, req) => {
        req.nmsConnectionType = 'ws';
        this.onConnect(req, ws);
      });

      this.wsServer.on('listening', () => {
        Logger.log(`Node Media WebSocket Server started on: ${this.host}:${this.port}`);
      });
      this.wsServer.on('error', (e) => {
        Logger.error(`Node Media WebSocket Server ${e}`);
      });
    }

    if (this.httpsServer) {
      this.httpsServer.listen(this.sport, this.shost, () => {
        Logger.log(`Node Media Https Server started on: ${this.shost}:${this.sport}`);
      });

      this.httpsServer.on('error', (e) => {
        Logger.error(`Node Media Https Server ${e}`);
      });

      this.httpsServer.on('close', () => {
        Logger.log('Node Media Https Server Close.');
      });

      this.wssServer = new WebSocket.Server({ server: this.httpsServer });

      this.wssServer.on('connection', (ws, req) => {
        req.nmsConnectionType = 'ws';
        this.onConnect(req, ws);
      });

      this.wssServer.on('listening', () => {
        Logger.log(`Node Media WebSocketSecure Server started on: ${this.shost}:${this.sport}`);
      });
      this.wssServer.on('error', (e) => {
        Logger.error(`Node Media WebSocketSecure Server ${e}`);
      });
    }

    context.nodeEvent.on('postPlay', (id, args) => {
      context.stat.accepted++;
    });

    context.nodeEvent.on('postPublish', (id, args) => {
      context.stat.accepted++;
    });

    context.nodeEvent.on('doneConnect', (id, args) => {
      let session = context.sessions.get(id);
      let socket = session instanceof NodeFlvSession ? session.req.socket : session.socket;
      context.stat.inbytes += socket.bytesRead;
      context.stat.outbytes += socket.bytesWritten;
    });
  }

  stop() {
    this.httpServer.close();
    if (this.httpsServer) {
      this.httpsServer.close();
    }
    context.sessions.forEach((session, id) => {
      if (session instanceof NodeFlvSession) {
        session.stop();
        session.req.destroy();
        context.sessions.delete(id);
      }
    });
  }

  onConnect(req, res) {
    let session = new NodeFlvSession(this.config, req, res);
    session.run();
  }
}

module.exports = NodeHttpServer;
