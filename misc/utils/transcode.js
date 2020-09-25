const tasks = [
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
  module.tasks = tasks;