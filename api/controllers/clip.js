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

const Logger = require('../../node_core_logger');


const config = require('../../misc/config');
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

function getArchiveSession(streamName){
  for (let session of this.nts.transSessions.values()) {
    console.log('getArchiveSession', session, session.conf);
    if(
      session &&
      session.conf.streamName &&
      session.conf.streamName === streamName &&
      session.rec
      ){
        return session;
    }
  }
  return false;
}


function clip(req, res, next) {
  let length = req.body.length;
  let name = req.body.name;
  let time = (new Date).getTime();
  console.log(this, this.conf, this.nts);
  Logger.info('Clip route', length, name);
  if (length && app && name) {
    if (length <= 0 || length < 60){ 
      res.sendStatus(400);
      res.end('Length too long');
      return;
    }

    const archiveSession = getArchiveSession(name);
    console.log(archiveSession);
    if (!archiveSession) {
      res.sendStatus(400);
      res.end('Stream is not being archived');
      return;
    }

    this.nodeEvent.emit('clip', length, name);
    let filename = `clip_${name}_${time}.mp4`;
    let fullPath = path.join(this.conf.rec, path.sep, filename);

    const argv = [
      '-i', `http://127.0.0.1:${this.config.http_port}/rec/live/${archiveSession.random/}${name}/indexarchive.m3u8`,
      '-sseof', `-${length}`,
      '-c', 'copy',
      '-bsf:a', 'aac_adtstoasc',
      '-f', 'mp4',
      fullPath
    ];

    this.ffmpeg_exec = spawn(this.conf.ffmpeg, argv);
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
    });

    res.sendStatus(200);
  } else {
    res.sendStatus(400);
  }
}

module.exports = {
  clip
};
