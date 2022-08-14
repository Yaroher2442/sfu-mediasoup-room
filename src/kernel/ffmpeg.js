// Class to handle child process used for running FFmpeg

const childProcess = require('child_process');
const { EventEmitter } = require('events');
const { Readable } = require('stream');
const { createSdpText } = require('./sdp');

const RECORD_FILE_LOCATION_PATH = process.env.RECORD_FILE_LOCATION_PATH || './files';

const getCodecInfoFromRtpParameters = (kind, rtpParameters) => ({
  payloadType: rtpParameters.codecs[0].payloadType,
  codecName: rtpParameters.codecs[0].mimeType.replace(`${kind}/`, ''),
  clockRate: rtpParameters.codecs[0].clockRate,
  channels: kind === 'audio' ? rtpParameters.codecs[0].channels : undefined,
});

const createSdpTextFromRtp = (rtpParameters) => {
  const { video, audio } = rtpParameters;

  // Video codec info
  const videoCodecInfo = getCodecInfoFromRtpParameters('video', video.rtpParameters);

  // Audio codec info
  const audioCodecInfo = getCodecInfoFromRtpParameters('audio', audio.rtpParameters);

  return `v=0
  o=- 0 0 IN IP4 127.0.0.1
  s=FFmpeg
  c=IN IP4 127.0.0.1
  t=0 0
  m=video ${video.remoteRtpPort} RTP/AVP ${videoCodecInfo.payloadType} 
  a=rtpmap:${videoCodecInfo.payloadType} ${videoCodecInfo.codecName}/${videoCodecInfo.clockRate}
  a=sendonly
  m=audio ${audio.remoteRtpPort} RTP/AVP ${audioCodecInfo.payloadType} 
  a=rtpmap:${audioCodecInfo.payloadType} ${audioCodecInfo.codecName}/${audioCodecInfo.clockRate}/${audioCodecInfo.channels}
  a=sendonly
  `;
};

const cretaStreamFromSdp = (stringToConvert) => {
  const stream = new Readable();
  stream.read = () => {};
  stream.push(stringToConvert);
  stream.push(null);
  return stream;
};

module.exports = class FFmpeg {
  constructor(rtpParameters) {
    this.rtpParameters = rtpParameters;
    this.process = undefined;
    this.observer = new EventEmitter();
    this.createProcess();
  }

  createProcess() {
    const sdpString = createSdpTextFromRtp(this.rtpParameters);
    const sdpStream = cretaStreamFromSdp(sdpString);

    console.log('createProcess() [sdpString:%s]', sdpString);

    this.process = childProcess.spawn('ffmpeg', this.commandArgs);

    if (this.process.stderr) {
      this.process.stderr.setEncoding('utf-8');

      this.process.stderr.on('data', (data) => console.log('ffmpeg::process::data [data:%o]', data));
    }

    if (this.process.stdout) {
      this.process.stdout.setEncoding('utf-8');

      this.process.stdout.on('data', (data) => console.log('ffmpeg::process::data [data:%o]', data));
    }

    this.process.on('message', (message) => console.log('ffmpeg::process::message [message:%o]', message));

    this.process.on('error', (error) => console.error('ffmpeg::process::error [error:%o]', error));

    this.process.once('close', () => {
      console.log('ffmpeg::process::close');
      this.observer.emit('process-close');
    });

    sdpStream.on('error', (error) => console.error('sdpStream::error [error:%o]', error));

    // Pipe sdp stream to the ffmpeg process
    sdpStream.resume();
    sdpStream.pipe(this.process.stdin);
  }

  kill() {
    console.log('kill() [pid:%d]', this.process.pid);
    this.process.kill('SIGINT');
  }

  get commandArgs() {
    let commandArgs = [
      '-loglevel',
      'debug',
      '-protocol_whitelist',
      'pipe,udp,rtp',
      '-fflags',
      '+genpts',
      '-f',
      'sdp',
      '-i',
      'pipe:0',
    ];

    const audioArgs = [
      '-map',
      '0:v:0',
      '-c:v',
      'copy',
    ];

    const videoArgs = [
      '-map',
      '0:a:0',
      '-strict', // libvorbis is experimental
      '-2',
      '-c:a',
      'copy',
    ];
    commandArgs = commandArgs.concat(audioArgs);
    commandArgs = commandArgs.concat(videoArgs);

    commandArgs = commandArgs.concat([
      /*
            '-flags',
            '+global_header',
            */
      `${RECORD_FILE_LOCATION_PATH}/${this.rtpParameters.fileName}.webm`,
    ]);

    console.log('commandArgs:%o', commandArgs);

    return commandArgs;
  }
};
