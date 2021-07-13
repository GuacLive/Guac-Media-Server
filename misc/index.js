const NodeMediaServer = require('../src/node_media_server');
const axios = require('axios');
const cron = require('node-cron')
// eslint-disable-next-line import/no-unresolved
const helpers = require('./utils/helpers');
const Logger = require('../src/node_core_logger');
const conf = require('./config');
const path = require('path');

const IS_DEBUG = false;//process.env.NODE_ENV === 'development';

const config = {
  logType: IS_DEBUG ? 4 : 2,
  hostServer: process.env['NMS_SERVER'] || 'lon.stream.guac.live',
  auth: {
    api_user: conf.api_user,
    api_pass: conf.api_pass
  },
  rtmp: {
    port: 1935,
    chunk_size: 100000,
    gop_cache: false,
    ping: 60,
    ping_timeout: 30
  },
  http: {
    api: true,
    port: conf.http_port,
    allow_origin: '*',
    mediaroot: path.resolve(__dirname+'/../media'),
    recroot: path.resolve(__dirname+'/../rec'),
  },
  misc: {
    api_endpoint: conf.endpoint,
    api_secret: conf.api_secret,
    ignore_auth: !!IS_DEBUG,
    maxDataRate: conf.maxDataRate || 8000,
    dataRateCheckInterval: conf.dataRateCheckInterval || 3,
    dataRateCheckCount: conf.dataRateCheckCount || 5, 
    transcode: conf.transcode,
    archive: conf.archive,
    generateThumbnail: conf.generateThumbnail,
  }
};

if (conf.https_port) {
  config.https = {
    port: conf.https_port,
    cert: conf.https_cert,
    key: conf.https_key
  };
}

if (conf.ffmpeg_path) {
  const transcodeTasks = require('../misc/utils/transcode');
  const tasks = [
    // source quality
    {
      app: 'live',
      ac: 'copy',
      vc: 'copy',
      hls: true,
      hlsFlags: 'hls_time=1:hls_list_size=5:hls_flags=delete_segments+program_date_time'
    }
  ];
  if(conf.archive){
    tasks.push(
      {
        app: 'live',
        ac: 'copy',
        vc: 'copy',
        hls: true,
        rec: true,
        hlsFlags: 'hls_time=15:hls_list_size=0'
      });
  }
  const combinedTasks = config.misc.transcode ? Object.assign(tasks, transcodeTasks) : tasks;

  config.trans = {
    ffmpeg: conf.ffmpeg_path,
    tasks: combinedTasks
  };
}

const nms = new NodeMediaServer(config);
nms.run();

nms.on('onMetaData', (id, metadata) => {
  console.log('onMetaData', id, metadata);
  let session = nms.getSession(id);
  if(metadata.videodatarate > config.misc.maxDataRate){
    Logger.error('Bitrate too high', `${Math.round(Math.floor(metadata.videodatarate))}/${config.misc.maxDataRate} kbps (max).`);
    session.sendStatusMessage(
      session.publishStreamId,
      'error',
      'NetStream.Publish.Rejected',
      `Bitrate too high, ${Math.round(Math.floor(metadata.videodatarate))}/${config.misc.maxDataRate} kbps (max).`
    );
    return session.reject();
  }
});

nms.on('postPublish', (id, StreamPath, args) => {
  let session = nms.getSession(id)
  console.log('[NodeEvent on postPublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
  if(config.misc.generateThumbnail){
    // Create a thumbnail
    try{
      helpers.generateStreamThumbnail(session.publishStreamPath);
    }catch(e){
    }

    // Generate a thumbnail every 60 seconds
    try{
      let task = cron.schedule('* * * * *', () => {
        helpers.generateStreamThumbnail(session.publishStreamPath)
      }, {
        scheduled: false
      });
      // Save tasks in the session so we can stop it later
      session.task = task;
      // Start the tasks
      task.start();
    }catch(e){
    }
  }
});

nms.on('donePublish', (id, StreamPath, args) => {
  let session = nms.getSession(id)

  // Stop thumbnail generation cron
  if(session.task) session.task.stop();
  // Remove thumbnail
  try{
    helpers.removeStreamThumbnail(session.publishStreamPath);
  }catch(e){
  }
  axios.post(
      `${config.misc.api_endpoint}/live/on_publish_done`,
      `name=${args.token}&streamServer=${config.hostServer}&tcUrl=${StreamPath}`, {
        maxRedirects: 0,
        validateStatus: function (status) {
          // Bypass redirect
          return status == 304 || (status >= 200 && status < 300);
        },
        headers: {
          Authorization: `Bearer ${config.misc.api_secret}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      })
    .then(response => {
      // eslint-disable-next-line no-console
      Logger.log(`[rtmp donePublish] id=${id} streamPath=${StreamPath}  args=${JSON.stringify(args)} `);
    })
    .catch(error => {
      // eslint-disable-next-line no-console
      Logger.error('[rtmp donePublish]', error);
    });
});