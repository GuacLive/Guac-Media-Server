const NodeMediaServer = require('../node_media_server');
const axios = require('axios');
const cron = require('node-cron')
// eslint-disable-next-line import/no-unresolved
const helpers = require('./utils/helpers');
const Logger = require('../node_core_logger');
const conf = require('./config');

const IS_DEBUG = false;//process.env.NODE_ENV === 'development';

const config = {
  logType: IS_DEBUG ? 4 : 2,
  auth: {
    api: true,
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
    port: conf.http_port,
    allow_origin: '*',
    mediaroot: './media'
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
  const transcodeTasks = [
    ,
    // low quality
    {
      app: 'live',
      name: '_low',
      ac: 'copy',
      acParam: ['-b:a', '96k', '-ar', 48000],
      vc: 'libx264',
      vcParam: ['-vf', "scale=480:-1", '-b:v', '800k', '-preset', 'superfast', '-profile:v', 'baseline', '-bufsize', '1200k','-crf', '35', '-muxdelay', '0', '-copyts', '-tune','zerolatency'],
      hls: true,
      hlsFlags: 'hls_time=1:hls_list_size=5:hls_flags=delete_segments'
    },
    // medium quality
    {
      app: 'live',
      name: '_medium',
      ac: 'copy',
      acParam: ['-b:a', '128k', '-ar', 48000],
      vc: 'libx264',
      vcParam: ['-vf', "scale=854:-1", '-b:v', '1400k', '-preset', 'superfast', '-profile:v', 'baseline', '-bufsize', '2100k','-crf', '35', '-muxdelay', '0', '-copyts', '-tune','zerolatency'],
      hls: true,
      hlsFlags: 'hls_time=1:hls_list_size=5:hls_flags=delete_segments'
    },
    // high quality
    {
      app: 'live',
      name: '_high',
      ac: 'copy',
      acParam: ['-b:a', '128k', '-ar', 48000],
      vc: 'libx264',
      vcParam: ['-vf', "scale=1280:-1", '-b:v', '2800k', '-preset', 'superfast', '-profile:v', 'baseline', '-bufsize', '4200k','-crf', '35', '-muxdelay', '0', '-copyts', '-tune','zerolatency'],
      hls: true,
      hlsFlags: 'hls_time=1:hls_list_size=5:hls_flags=delete_segments'
    }
  ];
  const tasks = [
    // source quality
    {
      app: 'live',
      ac: 'copy',
      vc: 'copy',
      hls: true,
      hlsFlags: 'hls_time=1:hls_list_size=5:hls_flags=delete_segments'
    }
  ];
  if(config.archive){
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
      `name=${args.token}&tcUrl=${StreamPath}`, {
        maxRedirects: 0,
        validateStatus: function (status) {
          // Bypass redirect
          return status == 304 || (status >= 200 && status < 300);
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      })
    .then(response => {
      // eslint-disable-next-line no-console
      //console.log('[donePublish]', response);
    })
    .catch(error => {
      // eslint-disable-next-line no-console
      console.log('[donePublish]', error);
    });
});