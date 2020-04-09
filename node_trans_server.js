//
//  Created by Mingliang Chen on 18/3/9.
//  illuspas[a]gmail.com
//  Copyright (c) 2018 Nodemedia. All rights reserved.
//
const Logger = require('./node_core_logger');

const NodeTransSession = require('./node_trans_session');
const context = require('./node_core_ctx');
const { getFFmpegVersion, getFFmpegUrl } = require('./node_core_utils');
const fs = require('fs');
const _ = require('lodash');
const mkdirp = require('mkdirp');

class NodeTransServer {
  constructor(config) {
    this.config = config;
    this.transSessions = new Map();
  }

  async run() {
    try {
      mkdirp.sync(this.config.http.mediaroot);
      fs.accessSync(this.config.http.mediaroot, fs.constants.W_OK);
    } catch (error) {
      Logger.error(`Node Media Trans Server startup failed. MediaRoot:${this.config.http.mediaroot} cannot be written.`);
      return;
    }

    try {
      fs.accessSync(this.config.trans.ffmpeg, fs.constants.X_OK);
    } catch (error) {
      Logger.error(`Node Media Trans Server startup failed. ffmpeg:${this.config.trans.ffmpeg} cannot be executed.`);
      return;
    }

    let version = await getFFmpegVersion(this.config.trans.ffmpeg);
    if (version === '' || parseInt(version.split('.')[0]) < 4) {
      Logger.error(`Node Media Trans Server startup failed. ffmpeg requires version 4.0.0 above`);
      Logger.error('Download the latest ffmpeg static program:', getFFmpegUrl());
      return;
    }

    let i = this.config.trans.tasks && this.config.trans.tasks.length
      ? this.config.trans.tasks.length : 0;
    let apps = '';
    while (i--) {
      apps += this.config.trans.tasks[i].app;
      apps += ' ';
    }
    context.nodeEvent.on('postPublish', this.onPostPublish.bind(this));
    context.nodeEvent.on('donePublish', this.onDonePublish.bind(this));
    Logger.log(`Node Media Trans Server started for apps: [ ${apps}] , MediaRoot: ${this.config.http.mediaroot}, ffmpeg version: ${version}`);
  }

  stop() {
    this.transSessions.forEach((session, id) => {
      session.end();
      // this.transSessions.delete(id);
    });
  }

  onPostPublish(id, streamPath, args) {
    let regRes = /\/(.*)\/(.*)/gi.exec(streamPath);
    let [app, name] = _.slice(regRes, 1);
    let i = this.config.trans.tasks && this.config.trans.tasks.length
      ? this.config.trans.tasks.length : 0;
    while (i--) {
      let conf = this.config.trans.tasks[i];
      conf.ffmpeg = this.config.trans.ffmpeg;
      conf.analyzeDuration = this.config.trans.analyzeDuration;
      conf.probeSize = this.config.trans.probeSize;
      conf.mediaroot = this.config.http.mediaroot;
      conf.rtmpPort = this.config.rtmp.port;
      conf.streamPath = streamPath;
      conf.streamApp = app;
      conf.streamName = name;
      conf.args = args;
      if (app === conf.app) {
        let taskId = `${app}_${conf.name || 'index'}_${id}`;
        let session = new NodeTransSession(conf);
        this.transSessions.set(taskId, session);
        session.on('progress', progress => {
          let data = {
            frames: progress.frames,
            fps: progress.currentFps,
            bitRate: progress.currentKbps,
            time: progress.timemark,
          };
          console.log('progress', data, taskId);
          if (this.transSessions.get(taskId)) {
            this.transSessions.get(taskId).data = data;
          }
        });
        session.on('end', () => {
          this.transSessions.delete(taskId);
        });
        session.run();
      }
    }
  }

  onDonePublish(id, streamPath, args) {
    let regRes = /\/(.*)\/(.*)/gi.exec(streamPath);
    let [app, name] = _.slice(regRes, 1);
    let i = this.config.trans.tasks && this.config.trans.tasks.length
      ? this.config.trans.tasks.length : 0;
    while (i--) {
      let conf = this.config.trans.tasks[i];
      if (app === conf.app) {
        let taskId = `${app}_${conf.name || 'index'}_${id}`;
        console.log('onDonePublish', taskId);
        let session = this.transSessions.get(taskId);
        if (session) {
          session.end();
        }
      }
    }
  }
}

module.exports = NodeTransServer;
