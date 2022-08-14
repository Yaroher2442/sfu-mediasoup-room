const mediasoup = require('mediasoup');
const express = require('express');
const https = require('https');
const fs = require('fs');
const Room = require('./kernel/room');
const config = require('./config');

const TESTROOMNAME = 'new_room';

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

  createNewRoom(roomId) {
    this.rooms[roomId] = new Room();
  }

  getRoom(roomId) {
    if (!this.rooms[roomId]) {
      throw Error('room not found');
    }
    return this.rooms[roomId];
  }
}

class Server {
  expressApp = express();

  mediaApp;

  constructor(mediaApp) {
    this.mediaApp = mediaApp;
    this.expressApp.set('mediaApp', mediaApp);
    this.expressApp.use(express.json({ type: '*/*' }));
    this.expressApp.use(express.static('./src/static'));
    this.createApi();
  }

  createApi() {
    this.expressApp.use((req, res, next) => {
      console.log(req.method, req.path);
      next();
    });

    this.expressApp.post('/signaling/sync', async (req, res) => {
      try {
        const mediaApp = req.app.get('mediaApp');
        const room = mediaApp.getRoom(TESTROOMNAME);
        const { peerId } = req.body;
        res.send(await room.syncRemotePeer(peerId));
      } catch (e) {
        console.log(e);
        res.status(400).send(e);
      }
    });
    this.expressApp.post('/signaling/join-as-new-peer', async (req, res) => {
      try {
        const mediaApp = req.app.get('mediaApp');
        const room = mediaApp.getRoom(TESTROOMNAME);
        const { peerId } = req.body;
        res.send(await room.join(peerId));
      } catch (e) {
        console.log(e);
        res.status(400).send(e);
      }
    });
    this.expressApp.post('/signaling/leave', async (req, res) => {
      try {
        const mediaApp = req.app.get('mediaApp');
        const room = mediaApp.getRoom(TESTROOMNAME);
        const { peerId } = req.body;
        res.send(await room.leave(peerId));
      } catch (e) {
        console.log(e);
        res.status(400).send(e);
      }
    });
    this.expressApp.post('/signaling/create-transport', async (req, res) => {
      try {
        const mediaApp = req.app.get('mediaApp');
        const room = mediaApp.getRoom(TESTROOMNAME);
        const { peerId, direction } = req.body;
        const peer = room.findPeer(peerId);
        res.send(await peer.crateNewTransport(direction));
      } catch (e) {
        console.log(e);
        res.status(400).send(e);
      }
    });
    this.expressApp.post('/signaling/connect-transport', async (req, res) => {
      try {
        const mediaApp = req.app.get('mediaApp');
        const room = mediaApp.getRoom(TESTROOMNAME);
        const { peerId, transportId, dtlsParameters } = req.body;
        const peer = room.findPeer(peerId);
        res.send(await peer.connectTransport(transportId, dtlsParameters));
      } catch (e) {
        console.log(e);
        res.status(400).send(e);
      }
    });
    this.expressApp.post('/signaling/close-transport', async (req, res) => {
      try {
        const mediaApp = req.app.get('mediaApp');
        const room = mediaApp.getRoom(TESTROOMNAME);
        const { peerId, transportId } = req.body;
        const peer = room.findPeer(peerId);
        res.send(await peer.closeTransport(transportId));
      } catch (e) {
        console.log(e);
        res.status(400).send(e);
      }
    });
    this.expressApp.post('/signaling/close-producer', async (req, res) => {
      try {
        const mediaApp = req.app.get('mediaApp');
        const room = mediaApp.getRoom(TESTROOMNAME);
        const { peerId, producerId } = req.body;
        const peer = room.findPeer(peerId);
        res.send(await peer.closeProducer(producerId));
      } catch (e) {
        console.log(e);
        res.status(400).send(e);
      }
    });
    this.expressApp.post('/signaling/send-track', async (req, res) => {
      try {
        const mediaApp = req.app.get('mediaApp');
        const room = mediaApp.getRoom(TESTROOMNAME);
        const {
          peerId, transportId, kind, rtpParameters,
          paused = false, appData,
        } = req.body;
        res.send(await room.peerSendTrack(
          peerId,
          transportId,
          kind,
          rtpParameters,
          appData,
          paused,
        ));
      } catch (e) {
        console.log(e);
        res.status(400).send(e);
      }
    });
    this.expressApp.post('/signaling/recv-track', async (req, res) => {
      try {
        const mediaApp = req.app.get('mediaApp');
        const room = mediaApp.getRoom(TESTROOMNAME);
        const {
          peerId, mediaPeerId, mediaTag, rtpCapabilities,
        } = req.body;
        // let peer = room.findPeer(peerId)
        // res.send(await peer.receiveTrack(mediaPeerId, mediaTag, rtpCapabilities))
        res.send(await room.peerReceiveTrack(peerId, mediaPeerId, mediaTag, rtpCapabilities));
      } catch (e) {
        console.log(e);
        res.status(400).send(e);
      }
    });
    this.expressApp.post('/signaling/pause-consumer', async (req, res) => {
      try {
        const mediaApp = req.app.get('mediaApp');
        const room = mediaApp.getRoom(TESTROOMNAME);
        const { peerId, consumerId } = req.body;
        const peer = room.findPeer(peerId);
        res.send(await peer.pauseConsumer(consumerId));
      } catch (e) {
        console.log(e);
        res.status(400).send(e);
      }
    });
    this.expressApp.post('/signaling/resume-consumer', async (req, res) => {
      try {
        const mediaApp = req.app.get('mediaApp');
        const room = mediaApp.getRoom(TESTROOMNAME);
        const { peerId, consumerId } = req.body;
        const peer = room.findPeer(peerId);
        res.send(await peer.resumeConsumer(consumerId));
      } catch (e) {
        console.log(e);
        res.status(400).send(e);
      }
    });
    this.expressApp.post('/signaling/close-consumer', async (req, res) => {
      try {
        const mediaApp = req.app.get('mediaApp');
        const room = mediaApp.getRoom(TESTROOMNAME);
        const { peerId, consumerId } = req.body;
        const peer = room.findPeer(peerId);
        res.send(await peer.closeConsumer(consumerId));
      } catch (e) {
        console.log(e);
        res.status(400).send(e);
      }
    });
    this.expressApp.post('/signaling/consumer-set-layers', async (req, res) => {
      try {
        const mediaApp = req.app.get('mediaApp');
        const room = mediaApp.getRoom(TESTROOMNAME);
        const { peerId, consumerId, spatialLayer } = req.body;
        const peer = room.findPeer(peerId);
        res.send(await peer.consumerSetLayers(consumerId, spatialLayer));
      } catch (e) {
        console.log(e);
        res.status(400).send(e);
      }
    });
    this.expressApp.post('/signaling/pause-producer', async (req, res) => {
      try {
        const mediaApp = req.app.get('mediaApp');
        const room = mediaApp.getRoom(TESTROOMNAME);
        const { peerId, producerId } = req.body;
        const peer = room.findPeer(peerId);
        res.send(await peer.pauseProducer(producerId));
      } catch (e) {
        console.log(e);
        res.status(400).send(e);
      }
    });
    this.expressApp.post('/signaling/resume-producer', async (req, res) => {
      try {
        const mediaApp = req.app.get('mediaApp');
        const room = mediaApp.getRoom(TESTROOMNAME);
        const { peerId, producerId } = req.body;
        const peer = room.findPeer(peerId);
        res.send(await peer.resumeProducer(producerId));
      } catch (e) {
        console.log(e);
        res.status(400).send(e);
      }
    });
  }

  async run() {
    let httpsServer;
    try {
      const tls = {
        cert: fs.readFileSync(config.sslCrt), key: fs.readFileSync(config.sslKey),
      };
      httpsServer = https.createServer(tls, this.expressApp);
      httpsServer.on('error', (e) => {
        console.error('https server error,', e.message);
      });
      await new Promise((resolve) => {
        httpsServer.listen(config.httpPort, config.httpIp, () => {
          console.log(`server is running and listening on https://${config.httpIp}:${config.httpPort}`);
          resolve();
        });
      });
    } catch (e) {
      if (e.code === 'ENOENT') {
        console.error('no certificates found (check config.js)');
        console.error('  could not start https server ... trying http');
      } else {
        console.error('could not start https server', e);
      }
      this.expressApp.listen(config.httpPort, config.httpIp, () => {
        console.log(`http server listening on port ${config.httpPort}`);
      });
    }
  }
}

async function main() {
  // start mediasoup

  console.log('starting mediasoup');
  const mediaApp = new MediaApp();
  mediaApp.createNewRoom(TESTROOMNAME);
  const room = mediaApp.getRoom(TESTROOMNAME);
  // room.router.observer.on();
  const worker = await mediaApp.createWorker();
  const { mediaCodecs } = config.mediasoup.router;
  const router = await worker.createRouter({ mediaCodecs });
  await room.createRouterAndObserver(router);
  const server = new Server(mediaApp);
  // start https server, falling back to http if https fails
  console.log('starting express');
  await server.run();

  // periodically clean up peers that disconnected without sending us
  // a final "beacon"
  setInterval(() => {
    room.deleteTimeOutedPeers();
  }, 1000);

  // periodically update video stats we're sending to peers
  setInterval(room.updatePeerStats, 3000);
}

main();

//
// for each peer that connects, we keep a table of peers and what
// tracks are being sent and received. we also need to know the last
// time we saw the peer, so that we can disconnect clients that have
// network issues.
//
// for this simple demo, each client polls the server at 1hz, and we
// just send this roomState.peers data structure as our answer to each
// poll request.
//
// [peerId] : {
//   joinTs: <ms timestamp>
//   lastSeenTs: <ms timestamp>
//   media: {
//     [mediaTag] : {
//       paused: <bool>
//       encodings: []
//     }
//   },
//   stats: {
//     producers: {
//       [producerId]: {
//         ...(selected producer stats)
//       }
//     consumers: {
//       [consumerId]: { ...(selected consumer stats) }
//     }
//   }
//   consumerLayers: {
//     [consumerId]:
//         currentLayer,
//         clientSelectedLayer,
//       }
//     }
//   }
// }
//
// we also send information about the active speaker, as tracked by
// our audioLevelObserver.
//
// internally, we keep lists of transports, producers, and
// consumers. whenever we create a transport, producer, or consumer,
// we save the remote peerId in the object's `appData`. for producers
// and consumers we also keep track of the client-side "media tag", to
// correlate tracks.
//
//
// our http server needs to send 'index.html' and 'client-bundle.js'.
// might as well just send everything in this directory ...
//
