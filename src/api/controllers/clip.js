//
//  Created by Thomas Lekanger on 4/4/2021.
//  datagutt[a]guac.live
//  Copyright (c) 2021 guac.live. All rights reserved.
//
const {
  spawn
} = require('child_process');
const path = require('path');
const _ = require('lodash');

const HLS = require('hls-parser');

const axios = require('axios');

const Logger = require('../../node_core_logger');

const HLS_TIME = 15;
const config = require('../../../misc/config');
const aws = require('aws-sdk');

aws.config.accessKeyId = config.s3.accessKey;
aws.config.secretAccessKey = config.s3.secret;
aws.config.logger = console;

// Fix for Linode object storage error
aws.util.update(aws.S3.prototype, {
  addExpect100Continue: function addExpect100Continue(req) {
      console.log('Depreciating this workaround, because introduced a bug');
      console.log('Check: https://github.com/andrewrk/node-s3-client/issues/74');
  }
});

const s3 = new aws.S3({
  endpoint: config.s3.endpoint
});
const fs = require('fs');

const getM3u8 = async (url) => {
  let data;
  await axios
    .get(url)
    .then((response) => {
      data = response.data;
    })
    .catch(async (e) => {
      if (!e.response) {
        return console.error(e);
      }
      console.error(e.response.data);
    });
  return data;
};

const upload = async data => {
  try {
    await s3.upload(data).promise();
  } catch (e) {
    console.error(e);
    console.error('Retry: ' + data.Key);
    await upload(data);
  }
};

const uploadClip = async (key, fullPath) => {
  try {
    await upload({
      Bucket: config.s3.bucket.replace('/stream-vods', '/stream-clips'),
      Key: key,
      Body: fs.createReadStream(fullPath),
      ACL: 'public-read'
    });
  } catch (e) {
    console.error(e);
  }
};

function getArchiveSession(transSessions, streamName){
  for (let session of transSessions.values()) {
    //console.log('getArchiveSession', session, session.conf);
    if(
      session &&
      session.conf.streamName &&
      session.conf.streamName === streamName &&
      session.conf.rec
      ){
        return session;
    }
  }
  return false;
}

async function clip(req, res, next) {
  let length = req.body.length;
  let name = req.body.name;
  let time = (new Date).getTime();
  Logger.log('Clip route', length, name);
  if (length && name) {
    if (length <= 0 || length > 60){ 
      res.status(400);
      res.send('Length too long');
      return;
    }

    const archiveSession = getArchiveSession(this.transSessions, name);
    console.log(archiveSession);
    if (!archiveSession) {
      res.status(400);
      res.send('Stream is not being archived');
      return;
    }

    this.nodeEvent.emit('clip', length, name);
    let archiveUrl = `http://${process.env['NMS_SERVER'] || 'lon.stream.guac.live'}/rec/live/${name}/${archiveSession.random}`
    let playlistUrl = `${archiveUrl}/indexarchive.m3u8`;
    let filename = `clip_${name}_${time}.mp4`;
    let fullPath = path.join(__dirname, '../../..', path.sep, 'rec', path.sep, 'live', path.sep, filename);

    const playlistData = await getM3u8(playlistUrl);
    var playlist;
    try{
      playlist = HLS.parse(playlistData);
    }catch(e){
      res.status(500);
      return res.send('Invalid HLS playlist for archive')
    }
    let startSegment;
    // If we are at the start of a stream, we might not have enough segments for x sec
    if(playlist.segments.length < Math.floor(length / HLS_TIME)){
      startSegment = 0;
    }else{
      startSegment = playlist.segments.length - 1 - Math.floor(length / HLS_TIME);
    }
    let endSegment = playlist.segments.length - 1;
    let segments = playlist.segments.slice(startSegment, endSegment);
    let segmentUris = segments.map((segment) => {
      return `${archiveUrl}/${segment.uri}`;
    })

    if(!segmentUris || segmentUris.length === 0){
      res.status(500);
      return res.send('No segment URIs found')
    }

    const argv = [
      '-protocol_whitelist', 'file,http,https,tcp,tls,concat',
      '-i', `concat:${segmentUris.join('|')}`,
      '-c', 'copy',
      '-bsf:a', 'aac_adtstoasc',
      '-f', 'mp4',
      fullPath
    ];

    this.ffmpeg_exec = spawn(config.ffmpeg_path, argv);
    this.ffmpeg_exec.on('error', (e) => {
      Logger.ffdebug(e);
    });

    this.ffmpeg_exec.stdout.on('data', (data) => {
      Logger.ffdebug(`ff clip out： ${data}`);
    });

    this.ffmpeg_exec.stderr.on('data', (data) => {
      Logger.ffdebug(`FF clip err： ${data}`);
    });
  
    this.ffmpeg_exec.on('close', async (code) => {
      await uploadClip(filename, fullPath);
      res.status(200);
      res.send({
        filename,
        url: `https://${config.s3.publishUrl.replace('/stream-vods', '/stream-clips')}/${filename}`,
        time
      });
    });

  } else {
    res.sendStatus(400);
  }
}

module.exports = {
  clip
};
