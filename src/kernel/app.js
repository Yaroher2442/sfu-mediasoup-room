const mediasoup = require('mediasoup');
const config = require('../config');
const Room = require('./room');

class MediaApp {
  worker;

  rooms;

  constructor() {
    this.rooms = {};
  }

  async createWorker() {
    this.worker = await mediasoup.createWorker({
      logLevel: config.mediasoup.worker.logLevel,
      logTags: config.mediasoup.worker.logTags,
      rtcMinPort: config.mediasoup.worker.rtcMinPort,
      rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
    });
    this.worker.on('died', () => {
      console.error('mediasoup worker died (this should never happen)');
      process.exit(1);
    });
    return this.worker;
  }

  async createNewRoom(roomId) {
    const room = new Room();
    const worker = await this.createWorker();
    const { mediaCodecs } = config.mediasoup.router;
    const router = await worker.createRouter({ mediaCodecs });
    await room.createRouterAndObserver(router);
    // periodically clean up peers that disconnected without sending us
    // a final "beacon"
    // TODO create this with sse
    // setInterval(() => {
    //   room.deleteTimeOutedPeers();
    // }, 1000);

    // periodically update video stats we're sending to peers
    setInterval(room.updatePeerStats, 3000);
    this.rooms[roomId] = room;
    return room;
  }

  async getRoom(roomId) {
    if (this.rooms[roomId]) {
      return this.rooms[roomId];
    }
    const room = await this.createNewRoom(roomId);
    return room;
  }

  checkLastPeerInRoom(roomId) {
    return Object.values(this.rooms[roomId].peers).length === 1;
  }

  deleteEmptyRoom(roomId) {
    delete this.rooms[roomId];
    console.log('asfasfasfasfasfasfasfasf');
  }
}
module.exports = MediaApp;
