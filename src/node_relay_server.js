//
//  Created by Mingliang Chen on 18/3/16.
//  illuspas[a]gmail.com
//  Copyright (c) 2018 Nodemedia. All rights reserved.
//
const Logger = require('./node_core_logger');

const NodeCoreUtils = require('./node_core_utils');
const NodeRelaySession = require('./node_relay_session');
const context = require('./node_core_ctx');
const { getFFmpegVersion, getFFmpegUrl } = require('./node_core_utils');
const fs = require('fs');
const querystring = require('querystring');
const _ = require('lodash');

class NodeRelayServer {
  constructor(config) {
    console.log(config)
    this.config = config;
    this.staticCycle = null;
    this.staticSessions = new Map();
    this.dynamicSessions = new Map();
  }

  async run() {
    try {
      fs.accessSync(this.config.relay.ffmpeg, fs.constants.X_OK);
    } catch (error) {
      Logger.error(`Node Media Relay Server startup failed. ffmpeg:${this.config.relay.ffmpeg} cannot be executed.`);
      return;
    }

    let version = await getFFmpegVersion(this.config.relay.ffmpeg);
    if (version === '' || parseInt(version.split('.')[0]) < 4) {
      Logger.error('Node Media Relay Server startup failed. ffmpeg requires version 4.0.0 above');
      Logger.error('Download the latest ffmpeg static program:', getFFmpegUrl());
      return;
    }
    context.nodeEvent.on('relayTask', this.onRelayTask.bind(this));
    context.nodeEvent.on('relayPull', this.onRelayPull.bind(this));
    context.nodeEvent.on('relayPush', this.onRelayPush.bind(this));
    context.nodeEvent.on('relayDelete', this.onRelayDelete.bind(this));
    context.nodeEvent.on('prePlay', this.onPrePlay.bind(this));
    context.nodeEvent.on('donePlay', this.onDonePlay.bind(this));
    context.nodeEvent.on('postPublish', this.onPostPublish.bind(this));
    context.nodeEvent.on('donePublish', this.onDonePublish.bind(this));
    let updateInterval = this.config.relay.update_interval ?
      this.config.relay.update_interval : 1000;
    this.staticCycle = setInterval(this.onStatic.bind(this), updateInterval);
    Logger.log('Node Media Relay Server started');
  }

  onStatic() {
    if (!this.config.relay.tasks) {
      return;
    }
    let i = this.config.relay.tasks.length;
    while (i--) {
      if (this.staticSessions.has(i)) {
        continue;
      }

      let conf = this.config.relay.tasks[i];
      let isStatic = conf.mode === 'static';
      if (isStatic) {
        conf.name = conf.name ? conf.name : NodeCoreUtils.genRandomName();
        conf.ffmpeg = this.config.relay.ffmpeg;
        conf.inPath = conf.edge;
        conf.ouPath = `rtmp://127.0.0.1:${this.config.rtmp.port}/${conf.app}/${conf.name}`;
        let session = new NodeRelaySession(conf);
        session.id = i;
        session.streamPath = `/${conf.app}/${conf.name}`;
        session.on('end', (id) => {
          context.sessions.delete(id);
          this.staticSessions.delete(id);
        });
        this.staticSessions.set(i, session);
        session.run();
        Logger.log('[relay static pull] start', i, conf.inPath, 'to', conf.ouPath);
      }
    }
  }

  onRelayTask(path, url) {
    let conf = {};
    conf.ffmpeg = this.config.relay.ffmpeg;
    conf.app = '-';
    conf.name = '-';
    conf.inPath = path;
    conf.ouPath = url;
    let session = new NodeRelaySession(conf);
    const id = session.id;
    context.sessions.set(id, session);
    session.on('end', (id) => {
      context.sessions.delete(id);
      this.dynamicSessions.delete(id);
    });
    this.dynamicSessions.set(id, session);
    session.run();
    Logger.log('[relay dynamic task] start id=' + id, conf.inPath, 'to', conf.ouPath);
    return id;
  }

  //从远端拉推到本地
  onRelayPull(url, app, name) {
    let conf = {};
    conf.app = app;
    conf.name = name;
    conf.mode = 'pull';
    conf.ffmpeg = this.config.relay.ffmpeg;
    conf.inPath = url;
    conf.ouPath = `rtmp://127.0.0.1:${this.config.rtmp.port}/${app}/${name}`;
    let session = new NodeRelaySession(conf);
    const id = session.id;
    context.sessions.set(id, session);
    session.on('end', (id) => {
      context.sessions.delete(id);
      let list = this.dynamicSessions.get(id);
      if (list.indexOf(session) > -1) {
        list.splice(list.indexOf(session), 1);
        if (list.length == 0) {
          this.dynamicSessions.delete(id);
        }
      }
    });
    if (!this.dynamicSessions.has(id)) {
      this.dynamicSessions.set(id, []);
    }
    this.dynamicSessions.get(id).push(session);
    session.run();
    Logger.log('[relay dynamic pull] start id=' + id, conf.inPath, 'to', conf.ouPath);
    return id;
  }

  //从本地拉推到远端
  onRelayPush(url, app, name) {
    let conf = {};
    conf.app = app;
    conf.name = name;
    conf.mode = 'push';
    conf.ffmpeg = this.config.relay.ffmpeg;
    conf.inPath = `rtmp://127.0.0.1:${this.config.rtmp.port}/${app}/${name}`;
    conf.ouPath = url;
    let session = new NodeRelaySession(conf);
    const id = session.id;
    context.sessions.set(id, session);
    session.on('end', (id) => {
      context.sessions.delete(id);
      let list = this.dynamicSessions.get(id);
      if (list.indexOf(session) > -1) {
        list.splice(list.indexOf(session), 1);
        if (list.length == 0) {
          this.dynamicSessions.delete(id);
        }
      }
    });
    if (!this.dynamicSessions.has(id)) {
      this.dynamicSessions.set(id, []);
    }
    this.dynamicSessions.get(id).push(session);
    session.run();
    Logger.log('[relay dynamic push] start id=' + id, conf.inPath, 'to', conf.ouPath);
  }

  onRelayDelete(id) {
    let session = context.sessions.get(id);
    
    if (session) {
      session.end();
      context.sessions.delete(id)
      Logger.log('[Relay dynamic session] end', id);
    }
  }

  onPrePlay(id, streamPath, args) {
    if (!this.config.relay.tasks) {
      return;
    }
    let regRes = /\/(.*)\/(.*)/gi.exec(streamPath);
    let [app, stream] = _.slice(regRes, 1);

    let conf = this.config.relay.tasks.find((config) => config.name === stream);
    if (conf) {
      let isPull = conf.mode === 'pull';
      if (isPull && app === conf.app && !context.publishers.has(streamPath) && conf) {
        let hasApp = conf.edge.match(/rtmp:\/\/([^\/]+)\/([^\/]+)/);
        conf.ffmpeg = this.config.relay.ffmpeg;
        conf.inPath = hasApp ? `${conf.edge}/${stream}` : `${conf.edge}`;
        conf.ouPath = `rtmp://127.0.0.1:${this.config.rtmp.port}${streamPath}`;
        if (Object.keys(args).length > 0) {
          conf.inPath += '?';
          conf.inPath += querystring.encode(args);
        }
        let session = new NodeRelaySession(conf);
        session.id = id;
        session.on('end', (id) => {
          let list = this.dynamicSessions.get(id);
          if (list.indexOf(session) > -1) {
            list.splice(list.indexOf(session), 1);
            if (list.length == 0) {
              this.dynamicSessions.delete(id);
            }
          }
        });
        if (!this.dynamicSessions.has(id)) {
          this.dynamicSessions.set(id, []);
        }
        this.dynamicSessions.get(id).push(session);
        session.run();
        Logger.log('[relay dynamic pull] start id=' + id, conf.inPath, 'to', conf.ouPath);
      }
    }
  }

  onDonePlay(id, streamPath, args) {
    let list = Array.from(this.dynamicSessions, ([name, value]) => value ).find((session)=>{return session.conf.name === streamPath.split('/')[2]});
    let publisher = context.sessions.get(context.publishers.get(streamPath));
    if (list && publisher.players.size == 0) {
      list.slice().forEach(session => session.end());
    }
  }

  onPostPublish(id, streamPath, args) {
    if (!this.config.relay.tasks) {
      return;
    }
    let regRes = /\/(.*)\/(.*)/gi.exec(streamPath);
    let [app, stream] = _.slice(regRes, 1);
    let i = this.config.relay.tasks.length;
    while (i--) {
      let conf = this.config.relay.tasks[i];
      let isPush = conf.mode === 'push';
      if (isPush && app === conf.app) {
        let hasApp = conf.edge.match(/rtmp:\/\/([^\/]+)\/([^\/]+)/);
        conf.ffmpeg = this.config.relay.ffmpeg;
        conf.inPath = `rtmp://127.0.0.1:${this.config.rtmp.port}${streamPath}`;
        conf.ouPath = conf.appendName === false ? conf.edge : (hasApp ? `${conf.edge}/${stream}` : `${conf.edge}${streamPath}`);
        if (Object.keys(args).length > 0) {
          conf.ouPath += '?';
          conf.ouPath += querystring.encode(args);
        }
        let session = new NodeRelaySession(conf);
        session.id = id;
        session.on('end', (id) => {
          let list = this.dynamicSessions.get(id);
          if (list.indexOf(session) > -1) {
            list.splice(list.indexOf(session), 1);
            if (list.length == 0) {
              this.dynamicSessions.delete(id);
            }
          }
        });
        if (!this.dynamicSessions.has(id)) {
          this.dynamicSessions.set(id, []);
        }
        this.dynamicSessions.get(id).push(session);
        session.run();
        Logger.log('[relay dynamic push] start id=' + id, conf.inPath, 'to', conf.ouPath);
      }
    }

  }

  onDonePublish(id, streamPath, args) {
    let list = this.dynamicSessions.get(id);
    if (list) {
      list.slice().forEach(session => session.end());
    }

    for (session of this.staticSessions.values()) {
      if (session.streamPath === streamPath) {
        session.end();
      }
    }
  }

  stop() {
    clearInterval(this.staticCycle);
    this.dynamicSessions.forEach((value, key, map) => {
      value.end()
      this.dynamicSessions.delete(key)
    })
    this.staticSessions.forEach((value, key, map) => {
      value.end()
      this.staticSessions.delete(key)
    })
  }
}

module.exports = NodeRelayServer;
