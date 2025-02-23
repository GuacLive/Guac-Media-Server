//
//  Created by Mingliang Chen on 18/3/9.
//  illuspas[a]gmail.com
//  Copyright (c) 2018 Nodemedia. All rights reserved.
//
const Logger = require('./node_core_logger');

const EventEmitter = require('events');
const {
  spawn
} = require('child_process');
const dateFormat = require('dateformat');
const mkdirp = require('mkdirp');
const fs = require('fs');

const { extractProgress } = require('../misc/utils/helpers');

const isHlsFile = (filename) => filename.endsWith('.ts') || filename.endsWith('.m3u8')
const isTempFiles = (filename) => filename.endsWith('.mpd') || filename.endsWith('.m4s') || filename.endsWith('.tmp')
class NodeTransSession extends EventEmitter {
  constructor(conf) {
    super();
    this.conf = conf;
    this.data = {};
    this.getConfig = (key = null) => {
      if (!key) return
      if (typeof this.conf != 'object') return
      if (this.conf.args && typeof this.conf.args === 'object' && this.conf.args[key]) return this.conf.args[key]
      return this.conf[key]
    }
  }

  run() {
    let vc = this.conf.vc || 'copy';
    let ac = this.conf.ac || 'copy';
    let inPath = 'rtmp://127.0.0.1:' + this.conf.rtmpPort + this.conf.streamPath;
    let ouPath = `${this.conf.mediaroot}/${this.conf.streamApp}/${this.conf.streamName}`;
    let mapStr = '';
    let analyzeDuration = this.conf.analyzeDuration || '1000000'; // used to be 2147483647
    let probeSize = this.conf.probeSize || '1000000'; // used to be 2147483647

    const start = new Date();
    const random = this.random = [...Array(11)].map(i => (~~(Math.random() * 36)).toString(36)).join('');
    ouPath += this.conf.rec ? `/${random}` : '';
    if(this.conf.rec && !this.conf.name) this.conf.name = 'archive';

    if (this.conf.rtmp && this.conf.rtmpApp) {
      if (this.conf.rtmpApp === this.conf.streamApp) {
        Logger.error('[Transmuxing RTMP] Cannot output to the same app.');
      } else {
        let rtmpOutput = `rtmp://127.0.0.1:${this.conf.rtmpPort}/${this.conf.rtmpApp}/${this.conf.streamName}`;
        mapStr += `[f=flv]${rtmpOutput}|`;
        Logger.log('[Transmuxing RTMP] ' + this.conf.streamPath + ' to ' + rtmpOutput);
      }
    }
    if (this.conf.mp4) {
      this.conf.mp4Flags = this.conf.mp4Flags ? this.conf.mp4Flags : '';
      let mp4FileName = dateFormat('yyyy-mm-dd-HH-MM-ss') + '.mp4';
      let mapMp4 = `${this.conf.mp4Flags}${ouPath}/${mp4FileName}|`;
      mapStr += mapMp4;
      Logger.log('[Transmuxing MP4] ' + this.conf.streamPath + ' to ' + ouPath + '/' + mp4FileName);
    }
    if (this.conf.hls) {
      this.conf.hlsFlags = this.conf.hlsFlags ? this.conf.hlsFlags : '';
      this.hlsFileName = this.conf.name ? `index${this.conf.name}.m3u8` : 'index.m3u8';
      let mapHls = `[${this.conf.hlsFlags}:hls_segment_filename=\'${ouPath}/stream_${this.conf.name || 'index'}${this.conf.rec ? '' : `_${random}`}_%d.ts\']${ouPath}/${this.hlsFileName}|`;
      mapStr += mapHls;
      Logger.log('[Transmuxing HLS] ' + this.conf.streamPath + ' to ' + ouPath + '/' + this.hlsFileName);
    }
    if (this.conf.dash) {
      this.conf.dashFlags = this.conf.dashFlags ? this.conf.dashFlags : '';
      let dashFileName = this.conf.name ? `index${this.conf.name}.mpd` : 'index.mpd';
      let mapDash = `${this.conf.dashFlags}${ouPath}/${dashFileName}`;
      mapStr += mapDash;
      Logger.log('[Transmuxing DASH] ' + this.conf.streamPath + ' to ' + ouPath + '/' + dashFileName);
    }
    if (this.conf.flv) {
      this.conf.flvFlags = this.conf.flvFlags ? this.conf.flvFlags : '';
      let flvFileName = this.conf.name ? `index${this.conf.name}.flv` : 'index.flv';
      let mapFlv = `${this.conf.flvFlags}${ouPath}/${flvFileName}|`;
      mapStr += mapFlv;
      Logger.log('[Transmuxing FLV] ' + this.conf.streamPath + ' to ' + ouPath + '/' + flvFileName);
    }
    mkdirp.sync(ouPath);
    let argv = ['-y', '-flags', 'low_delay', '-fflags', 'nobuffer', '-analyzeduration', analyzeDuration, '-probesize', probeSize, '-i', inPath];
    Array.prototype.push.apply(argv, ['-c:v', vc]);
    Array.prototype.push.apply(argv, this.conf.vcParam);
    Array.prototype.push.apply(argv, ['-c:a', ac]);
    Array.prototype.push.apply(argv, this.conf.acParam);
    if (this.conf.rec) {
      Array.prototype.push.apply(argv, ['-t', '14400']);
    }
    Array.prototype.push.apply(argv, ['-f', 'tee', '-map', '0:a?', '-map', '0:v?', mapStr]);
    argv = argv.filter((n) => {
      return n
    }); //去空
    this.ffmpeg_exec = spawn(this.conf.ffmpeg, argv);
    this.ffmpeg_exec.on('error', (e) => {
      Logger.ffdebug(e);
    });

    this.ffmpeg_exec.stdout.on('data', (data) => {
      Logger.ffdebug(`FF输出：${data}`);
    });

    this.ffmpeg_exec.stderr.on('data', (data) => {
      extractProgress(this, data.toString());
      Logger.ffdebug(`FF输出：${data}`);
    });

    this.ffmpeg_exec.on('close', (code) => {
      Logger.log('[Transmuxing end] ' + this.conf.streamPath);
      this.emit('end');

      const date = new Date();
      const key = `live/archives/${date.getFullYear()}_${(`0${date.getMonth() + 1}`).slice(-2)}/${random}/`;

      if (this.conf.rec) {
        console.log('recording: ' + 'node' + ' archive.js ' + random+ ' ' + this.conf.streamName + ' ' + key + ' ' + ((date - start) / 1000).toFixed() + ' ' + ouPath);
        const archive = spawn('node', ['archive.js', random, this.conf.streamName, key, ((date - start) / 1000).toFixed(), ouPath]);
        archive.stderr.pipe(process.stderr);
        archive.stdout.pipe(process.stdout);
        return;
      }

    
      this.cleanTempFiles(ouPath);
      this.deleteHlsFiles(ouPath);
      this.createEmptyHlsFile(ouPath);
    });
  }

  end() {
    this.ffmpeg_exec.stdin.write('q');
  }

  // delete hls files
  deleteHlsFiles (ouPath) {
    if ((!ouPath && !this.conf.hls) || this.getConfig('hlsKeep')) return
    fs.readdir(ouPath, function (err, files) {
      if (err) return
      files.filter((filename) => isHlsFile(filename)).forEach((filename) => {
        fs.unlinkSync(`${ouPath}/${filename}`);
      });
    });
  }

  // delete the other files
  cleanTempFiles (ouPath) {
    if (!ouPath) return
    fs.readdir(ouPath, function (err, files) {
      if (err) return
      files.filter((filename) => isTempFiles(filename)).forEach((filename) => {
        fs.unlinkSync(`${ouPath}/${filename}`);
      });
    });
  }

  // create an empty hls file
  createEmptyHlsFile (ouPath) {
    if (!ouPath) return
    try {
      fs.writeFileSync(ouPath + '/' + this.hlsFileName, '#EXTM3U\n');
    } catch(e) {}
  }
}
module.exports = NodeTransSession;