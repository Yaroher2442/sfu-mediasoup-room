const express = require('express');
const https = require('https');
const fs = require('fs');
const cors = require('cors');
const config = require('./config');
const MediaApp = require('./kernel/app');

class Server {
  expressApp = express();

  mediaApp;

  sse;

  constructor(mediaApp) {
    this.mediaApp = mediaApp;
    // TODO create sse with events
    // this.sse = new SSE();
    // this.expressApp.set('sse', this.sse);
    // this.expressApp.get('/events', this.sse.init);

    this.expressApp.set('mediaApp', mediaApp);
    this.expressApp.use(cors());
    this.expressApp.use(express.json({ type: '*/*' }));
    this.expressApp.use('/:roomId', express.static('./src/static'));
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
        const { peerId, roomId } = req.body;
        const room = await mediaApp.getRoom(roomId);
        res.send(await room.syncRemotePeer(peerId));
      } catch (e) {
        console.log(e);
        res.status(400).send(e);
      }
    });
    this.expressApp.post('/signaling/join', async (req, res) => {
      try {
        const mediaApp = req.app.get('mediaApp');
        const { peerId, roomId } = req.body;
        const room = await mediaApp.getRoom(roomId);
        res.send(await room.join(peerId));
      } catch (e) {
        console.log(e);
        res.status(400).send(e);
      }
    });
    this.expressApp.post('/signaling/leave', async (req, res) => {
      try {
        const mediaApp = req.app.get('mediaApp');
        const { peerId, roomId } = req.body;
        const room = await mediaApp.getRoom(roomId);
        const isLastPeer = mediaApp.checkLastPeerInRoom(roomId);
        const response = await room.leave(peerId);
        if (isLastPeer) {
          mediaApp.deleteEmptyRoom(roomId);
        }
        res.send(response);
      } catch (e) {
        console.log(e);
        res.status(400).send(e);
      }
    });
    this.expressApp.post('/signaling/create-transport', async (req, res) => {
      try {
        const mediaApp = req.app.get('mediaApp');
        const { peerId, direction, roomId } = req.body;
        const room = await mediaApp.getRoom(roomId);
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
        const {
          peerId, transportId, dtlsParameters, roomId,
        } = req.body;
        const room = await mediaApp.getRoom(roomId);
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
        const { peerId, transportId, roomId } = req.body;
        const room = await mediaApp.getRoom(roomId);
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
        const { peerId, producerId, roomId } = req.body;
        const room = await mediaApp.getRoom(roomId);
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
        const {
          peerId, transportId, kind, rtpParameters,
          paused = false, appData, roomId,
        } = req.body;
        const room = await mediaApp.getRoom(roomId);
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
        const {
          peerId, mediaPeerId, mediaTag, rtpCapabilities, roomId,
        } = req.body;
        const room = await mediaApp.getRoom(roomId);
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
        const { peerId, consumerId, roomId } = req.body;
        const room = await mediaApp.getRoom(roomId);
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
        const { peerId, consumerId, roomId } = req.body;
        const room = await mediaApp.getRoom(roomId);
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
        const { peerId, consumerId, roomId } = req.body;
        const room = await mediaApp.getRoom(roomId);
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
        const {
          peerId, consumerId, spatialLayer, roomId,
        } = req.body;
        const room = await mediaApp.getRoom(roomId);
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
        const { peerId, producerId, roomId } = req.body;
        const room = await mediaApp.getRoom(roomId);
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
        const { peerId, producerId, roomId } = req.body;
        const room = await mediaApp.getRoom(roomId);
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

  const server = new Server(mediaApp);
  // start https server, falling back to http if https fails
  console.log('starting express');
  await server.run();
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
