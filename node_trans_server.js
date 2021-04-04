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

const makeABRPlaylist = require('./misc/utils/helpers').makeABRPlaylist;
const getStreamConfig = require('./misc/utils/helpers').getStreamConfig;

const transcodeTasks = require('./misc/utils/transcode').tasks;

class NodeTransServer {
  constructor(config) {
    this.config = config;
    if(context.transSessions !== 'object') context.transSessions = new Map();
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
    context.nodeEvent.on('transAdd', this.onTransAdd.bind(this));
    context.nodeEvent.on('transDel', this.onTransDel.bind(this));
    context.nodeEvent.on('postPublish', this.onPostPublish.bind(this));
    context.nodeEvent.on('donePublish', this.onDonePublish.bind(this));
    Logger.log(`Node Media Trans Server started for apps: [ ${apps}] , MediaRoot: ${this.config.http.mediaroot}, ffmpeg version: ${version}`);
  }

  stop() {
    context.transSessions.forEach((session, id) => {
      session.end();
      context.transSessions.delete(id);
    });
  }

  onTransAdd(id, streamPath, taskName) {
    let regRes = /\/(.*)\/(.*)/gi.exec(streamPath);
    let [app, name] = _.slice(regRes, 1);
    let i = transcodeTasks && transcodeTasks.length
      ? transcodeTasks.length : 0;
    
    // Create ABR (adaptive bitrate) playlist
    let ouPath = `${this.config.http.mediaroot}/${app}/${name}`;
    makeABRPlaylist(ouPath, name, true);
    // Start transcoding sessions
    while (i--) {
      let conf = { ...transcodeTasks[i] };
      conf.ffmpeg = this.config.trans.ffmpeg;
      conf.analyzeDuration = this.config.trans.analyzeDuration;
      conf.probeSize = this.config.trans.probeSize;
      conf.mediaroot = this.config.http.mediaroot;
      conf.rtmpPort = this.config.rtmp.port;
      conf.streamPath = streamPath;
      conf.streamApp = app;
      conf.streamName = name;
      if (app === conf.app && conf.name === taskName) {
        if(conf.rec && !conf.name){
          conf.name = 'archive';
        }
        let taskId = `${app}_${conf.name || 'index'}_${id}`;
        let session = new NodeTransSession(conf);
        context.transSessions.set(taskId, session);
        session.on('progress', progress => {
          let data = {
            frames: progress.frames,
            fps: progress.currentFps,
            bitRate: progress.currentKbps,
            time: progress.timemark,
          };
          console.log('progress', data, taskId);
          if (context.transSessions.get(taskId)) {
            context.transSessions.get(taskId).data = data;
          }
        });
        session.on('end', () => {
          context.transSessions.delete(taskId);
        });
        session.run();
      }
    }
  }

  onTransDel(id, streamPath, taskName) {
    let regRes = /\/(.*)\/(.*)/gi.exec(streamPath);
    let [app, name] = _.slice(regRes, 1);
    let i = transcodeTasks && transcodeTasks.length
      ? transcodeTasks.length : 0;
    while (i--) {
      let conf = transcodeTasks[i];
      if (app === conf.app && conf.name === taskName) {
        if(conf.rec && !conf.name){
          conf.name = 'archive';
        }
        let taskId = `${app}_${conf.name || 'index'}_${id}`;
        console.log('onTransDelete', taskId);
        let session = context.transSessions.get(taskId);
        if (session) {
          session.end();
        }
      }
    }
  }

  async onPostPublish(id, streamPath, args) {
    let regRes = /\/(.*)\/(.*)/gi.exec(streamPath);
    let [app, name] = _.slice(regRes, 1);
    let i = this.config.trans.tasks && this.config.trans.tasks.length
      ? this.config.trans.tasks.length : 0;
    
    // Create ABR (adaptive bitrate) playlist
    let ouPath = `${this.config.http.mediaroot}/${app}/${name}`;
    makeABRPlaylist(ouPath, name, this.config.misc.transcode);
    // Start transcoding sessions
    while (i--) {
      let conf = { ...this.config.trans.tasks[i] };
      conf.ffmpeg = this.config.trans.ffmpeg;
      conf.analyzeDuration = this.config.trans.analyzeDuration;
      conf.probeSize = this.config.trans.probeSize;
      conf.mediaroot = conf.rec ? this.config.http.recroot : this.config.http.mediaroot;
      conf.rtmpPort = this.config.rtmp.port;
      conf.streamPath = streamPath;
      conf.streamApp = app;
      conf.streamName = name;
      conf.args = args;

      // Grab streamer details (archive status, bitrate, possibly more in the future)
      const streamConfig = await getStreamConfig(name);

      // If this is a recording task, check if they have enabled archival
      if(conf.rec && !streamConfig.archive){
        // noop
        Logger.log('conf.rec but archive disabled, noop');
      }else if (app === conf.app) {
        if(conf.rec && !conf.name){
          conf.name = 'archive';
        }
        let taskId = `${app}_${conf.name || 'index'}_${id}`;
        let session = new NodeTransSession(conf);
        context.transSessions.set(taskId, session);
        session.on('progress', progress => {
          let data = {
            frames: progress.frames,
            fps: progress.currentFps,
            bitRate: progress.currentKbps,
            time: progress.timemark,
          };
          console.log('progress', data, taskId);
          if (context.transSessions.get(taskId)) {
            context.transSessions.get(taskId).data = data;
          }
        });
        session.on('end', () => {
          context.transSessions.delete(taskId);
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
        if(conf.rec && !conf.name){
          conf.name = 'archive';
        }
        let taskId = `${app}_${conf.name || 'index'}_${id}`;
        console.log('onDonePublish', taskId);
        let session = context.transSessions.get(taskId);
        if (session) {
          session.end();
        }
      }
    }
  }
}

module.exports = NodeTransServer;
