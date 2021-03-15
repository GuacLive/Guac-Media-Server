const config = require('./misc/config');
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
const axios = require('axios');
const Promise = require('bluebird').Promise;

const random = process.argv[2];
const streamName = process.argv[3];
const key = process.argv[4];
const duration = process.argv[5];
const ouPath = process.argv[6];

const upload = async data => {
  try {
    await s3.upload(data).promise();
  } catch (e) {
    console.error(e);
    console.error('Retry: ' + data.Key);
    await upload(data);
  }
};

const uploadThumb = async () => {
  try {
    const thumb = await axios.get(`http://127.0.0.1:${config.http_port}/live/${streamName}/thumbnail.jpg?v=${Math.floor((new Date().getTime() - 15000) / 60000)}`,
      {responseType: 'arraybuffer'});
    await upload({
      Bucket: config.s3.bucket,
      Key: key + 'thumbnail.jpg',
      Body: thumb.data,
      ACL: 'public-read'
    });
  } catch (e) {
    console.error(e);
  }
};

const uploadVideos = async retry => {
  const promises = [];

  for (const filename of fs.readdirSync(ouPath)) {
    if (filename.endsWith('.ts')
      || filename.endsWith('.m3u8')
      || filename.endsWith('.mpd')
      || filename.endsWith('.m4s')
      || filename.endsWith('.tmp')) {
      const path = ouPath + '/' + filename;
      console.log(path);
      promises.push({
        Bucket: config.s3.bucket,
        Key: key + filename,
        Body: fs.createReadStream(path),
        ACL: 'public-read'
      });
    }
  }

  try {
    await Promise.map(promises, data => s3.upload(data).promise().then(() => fs.unlinkSync(data.Body.path)), {concurrency: config.s3.concurrency});
  } catch (e) {
    console.error(e);
    await new Promise(resolve => setTimeout(resolve, 5000));
    await uploadVideos(true);
  }

  if (retry) return;
  setTimeout(() => fs.rmdirSync(ouPath), 10000);
  axios.post(
    `${config.endpoint}/archive`,
    {
      streamName,
      duration,
      random,
      thumbnail: encodeURIComponent(`https://${config.s3.publishUrl}/${key}thumbnail.jpg`),
      stream: encodeURIComponent(`https://${config.s3.publishUrl}/${key}indexarchive.m3u8`)
    },
    {
      headers: {
        'Authorization': `Bearer ${config.api_secret}`
      }
    }
  );
};

(async () => {
  await uploadThumb();
  await uploadVideos(false);
})();