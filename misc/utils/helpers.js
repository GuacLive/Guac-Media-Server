const spawn = require('child_process').spawn;

const axios = require('axios');
const Logger = require('../../node_core_logger');

const config = require('../config');
const cmd = config.ffmpeg_path;

const express = require('express');
const bodyParser = require('body-parser');

const router = context => {
  const router = express.Router();

  router.use(
    bodyParser.urlencoded({
      extended: true
    })
  );
  router.use(bodyParser.json());

  router.post('/stop', (req, res) => {
    const { stream } = req.body;
    const path = '/live/' + stream;

    const id = context.publishers.get(path);
    if (!id) {
      return res.end();
    }

    const session = context.sessions.get(id);
    if (!session) {
      return res.end();
    }

    // Stop thumbnail generation cron
    if(session.task) session.task.stop();

    session.reject();
  });

  return router;
};


const auth = (data, callback) => {
    if(data.config.misc.ignore_auth){
        callback();
        return;
    }

    if(!data || !data.publishStreamPath || data.publishStreamPath.indexOf('/live/') !== 0){
        data.sendStatusMessage(data.publishStreamId, 'error', 'NetStream.publish.Unauthorized', 'Authorization required.');
        return;
    }

    axios.post(
            `${data.config.misc.api_endpoint}/live/publish`,
            `name=${data.publishArgs.token}&tcUrl=${data.publishStreamPath}`, {
                maxRedirects: 0,
                validateStatus: (status) => {
                    // Bypass redirect
                    return status == 304 || (status >= 200 && status < 300);
                },
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            })
        .then(response => {
            console.info('Response from auth', response);
            callback();
        }).catch(error => {
            console.error(error);
            Logger.log(`[rtmp publish] Unauthorized. id=${data.id} streamPath=${data.publishStreamPath} streamId=${data.publishStreamId} token=${data.publishArgs.token} `);
            data.sendStatusMessage(data.publishStreamId, 'error', 'NetStream.publish.Unauthorized', 'Authorization required.');
        });
};

const generateStreamThumbnail = (streamPath) => {
    const args = [
        '-i', `media${streamPath}/index.m3u8`,
        '-vcodec' ,'png',
        '-frames:v', '2',
        '-an',
        '-f', 'rawvideo',
        //'-vf', 'scale=-2:300', // see if disabling scaling reduces CPU
        '-ss', '00:00:01',
        '-y',
        `media${streamPath}/thumbnail.png`,
    ];

    Logger.log('[Thumbnail generation] screenshot', args)
    let inst = spawn(cmd, args, {
    });
    inst.stdout.on('data', function(data) {
        //console.log('stdout: ' + data);
    });
    inst.stderr.on('data', function(data) {
        //console.log('stderr: ' + data);
    });

    inst.unref();
};

const removeStreamThumbnail = (streamPath) => {
    let path = `media${streamPath}/thumbnail.png`;
    fs.unlink(path, (error) => {
        if(error) Logger.log('[Thumbnail removal] screenshot', error)
    })
};

const parseProgressLine = (line) => {
    var progress = {};

    // Remove all spaces after = and trim
    line = line.replace(/=\s+/g, '=').trim();
    var progressParts = line.split(' ');

    // Split every progress part by "=" to get key and value
    for (var i = 0; i < progressParts.length; i++) {
        var progressSplit = progressParts[i].split('=', 2);
        var key = progressSplit[0];
        var value = progressSplit[1];

        // This is not a progress line
        if (typeof value === 'undefined')
            return null;

        progress[key] = value;
    }

    return progress;
};
const extractProgress = (command, stderrLine) => {
    var progress = parseProgressLine(stderrLine);

    if (progress) {
        // build progress report object
        var ret = {
            frames: parseInt(progress.frame, 10),
            currentFps: parseInt(progress.fps, 10),
            currentKbps: progress.bitrate ? parseFloat(progress.bitrate.replace('kbits/s', '')) : 0,
            targetSize: parseInt(progress.size || progress.Lsize, 10),
            timemark: progress.time
        };
        command.emit('progress', ret);
    }
};

module.exports = {
    router,
    auth,
    generateStreamThumbnail,
    removeStreamThumbnail,
    extractProgress
};