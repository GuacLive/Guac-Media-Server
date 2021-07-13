//
//  Created by Mingliang Chen on 17/8/1.
//  illuspas[a]gmail.com
//  Copyright (c) 2018 Nodemedia. All rights reserved.
//

const Logger = require('./node_core_logger');
const NodeRtmpServer = require('./node_rtmp_server');
const NodeHttpServer = require('./node_http_server');
const NodeTransServer = require('./node_trans_server');
const NodeRelayServer = require('./node_relay_server');
const NodeFissionServer = require('./node_fission_server');
const context = require('./node_core_ctx');

const Package = require('../package.json');
class NodeMediaServer {
  constructor(config) {
    this.config = config;
  }

  run() {
    Logger.setLogType(this.config.logType);
    Logger.log(`Guac Media Server v${Package.version}`);

    if (this.config.rtmp) {
      this.nrs = new NodeRtmpServer(this.config);
      this.nrs.run();
    }

    if (this.config.http) {
      this.nhs = new NodeHttpServer(this.config);
      this.nhs.run();
    }

    if (this.config.trans) {
      if (this.config.cluster) {
        Logger.log('NodeTransServer does not work in cluster mode');
      } else {
        this.nts = new NodeTransServer(this.config);
        this.nts.run();
      }
    }

    if (this.config.relay) {
      if (this.config.cluster) {
        Logger.log('NodeRelayServer does not work in cluster mode');
      } else {
        this.nls = new NodeRelayServer(this.config);
        this.nls.run();
      }
    }
    
    Logger.log('Overwriting uncaughtException handler - node-media-server!');

    if (this.config.fission) {
      if (this.config.cluster) {
        Logger.log('NodeFissionServer does not work in cluster mode');
      } else {
        this.nfs = new NodeFissionServer(this.config);
        this.nfs.run();
      }
    }

    process.on('uncaughtException', function (err) {
      Logger.error('uncaughtException', err);
    });
  
    process.on('SIGINT', function() {
      process.exit();
    });
  }

  on(eventName, listener) {
    context.nodeEvent.on(eventName, listener);
  }

  events() { return context.nodeEvent; }

  stop() {
    if (this.nrs) { this.nrs.stop(); }
    if (this.nhs) { this.nhs.stop(); }
    if (this.nts) { this.nts.stop(); }
    if (this.nls) { this.nls.stop(); }
  }

  getSession(id) {
    return context.sessions.get(id);
  }

  getSessionInfo() {
    let info = {
      rtmp: 0,
      http: 0,
      ws: 0
    };
    for (let session of context.sessions.values()) {
      info.rtmp += session.TAG === 'rtmp' ? 1 : 0;
      info.http += session.TAG === 'http-flv' ? 1 : 0;
      info.ws += session.TAG === 'websocket-flv' ? 1 : 0;
    }
    return info;
  }
}

module.exports = NodeMediaServer;