const spawn = require('child_process').spawn;

const axios = require('axios');

const fs = require('fs');

const Logger = require('../../node_core_logger');

const config = require('../config');
const cmd = config.ffmpeg_path;

const express = require('express');

const router = context => {
  const router = express.Router();

  router.use(
    express.urlencoded({
      extended: true
    })
  );
  router.use(express.json());

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
            `name=${data.publishArgs.token}&streamServer=${data.config.hostServer}&tcUrl=${data.publishStreamPath}`, {
                maxRedirects: 0,
                validateStatus: (status) => {
                    // Bypass redirect
                    return status == 304 || (status >= 200 && status < 300);
                },
                headers: {
                    Authorization: `Bearer ${data.config.misc.api_secret}`,
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


const getStreamConfig = (name) => {
    return new Promise((resolve, reject) => {
        if(config.misc.ignore_auth){
            resolve({archive: true});
            return;
        }
        axios.get(`${config.misc.api_endpoint}/streamConfig/${name}`, {
            headers: {
                Authorization: `Bearer ${data.config.misc.api_secret}`
            }
        })
        .then(response => {
            console.info('Response from getStreamConfig', response);
            resolve(response);
        }).catch(error => {
            console.error(error);
            reject(error);
        });
    });
};


const generateStreamThumbnail = (streamPath) => {
    const args = [
        '-err_detect ignore_err',
        '-ignore_unknown',
        '-stats',
        '-i', `media${streamPath}/index.m3u8`,
        '-fflags nobuffer+genpts+igndts',
        '-threads 1',
        '-frames:v 1', // frames
        '-q:v 25', // image quality
        '-an', // no audio
        '-y', // overwrite file
        `media${streamPath}/thumbnail.jpg`,
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

const ABRTemplate = (name, transcodeEnabled = false) => {
    let line = `#EXTM3U\n#EXT-X-VERSION:4\n`;
    line += `#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="src",NAME="src",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="en"\n`;
    if (transcodeEnabled) {
        line += `#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=800000,RESOLUTION=640x360,VIDEO="low"\n./../../live/${name}/index_low.m3u8\n`;
        line += `#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1400000,RESOLUTION=842x480,VIDEO="medium"\n./../../live/${name}/index_medium.m3u8\n`;
        line += `#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=2800000,RESOLUTION=1280x720,VIDEO="high"\n./../../live/${name}/index_high.m3u8\n`;
    }
    line += `#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=5000000,RESOLUTION=1920x1080,VIDEO="src"\n./../../live/${name}/index.m3u8`;
    return line;
};

const makeABRPlaylist = (ouPath, name, transcodeEnabled) => {
    return new Promise((resolve, reject) => {
        const playlist = `${ouPath}/abr.m3u8`;
        fs.open(playlist, 'w', (err, fd) => {
            if (err) {
                reject(err.message);
            } else {
                fs.writeFile(fd, ABRTemplate(name, transcodeEnabled), errWrite => {
                    if (errWrite) {
                        reject(errWrite.message);
                        return;
                    } else {
                        fs.close(fd, () => {
                            resolve();
                        });
                    }
                });
            }
        });
    });
};

module.exports = {
    router,
    auth,
    getStreamConfig,
    generateStreamThumbnail,
    removeStreamThumbnail,
    extractProgress,
    makeABRPlaylist
};