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
        '-y',
        '-i', `http://127.0.0.1:${config.http_port || 80}${streamPath}/index.m3u8`,
        '-ss', '00:00:01',
        '-f', 'image2',
        '-vframes', '1',
        '-vcodec' ,'png',
        '-vf', 'scale=-2:300',
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

let removeStreamThumbnail = (streamPath) => {
    let path = `media${streamPath}/thumbnail.png`;
    fs.unlink(path, (error) => {
        if(error) Logger.log('[Thumbnail removal] screenshot', error)
    })
}
module.exports = {
    router,
    auth,
    generateStreamThumbnail,
    removeStreamThumbnail
};