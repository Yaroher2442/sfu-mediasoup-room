const config = require('./config');
const mediasoup = require('mediasoup');
const express = require('express');
const https = require('https');
const fs = require('fs');
const Room = require("./layer/room")
const {observer} = require("mediasoup");


let TESTROOMNAME = "new_room"

class MediaApp {
    worker
    rooms

    constructor() {
        this.rooms = {}
    }

    async createWorker() {
        this.worker = await mediasoup.createWorker({
            logLevel: config.mediasoup.worker.logLevel,
            logTags: config.mediasoup.worker.logTags,
            rtcMinPort: config.mediasoup.worker.rtcMinPort,
            rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
        });
        this.worker.on('died', this.onWorkerDie)
        return this.worker
    }

    onWorkerDie() {
        console.error('mediasoup worker died (this should never happen)');
        process.exit(1);
    }

    createNewRoom(roomId) {
        this.rooms[roomId] = new Room()
    }

    getRoom(roomId) {
        if (!this.rooms[roomId]) {
            throw Error("room not found")
        }
        return this.rooms[roomId]
    }
}


class Server {
    expressApp = express();
    mediaApp

    constructor(mediaApp) {
        this.mediaApp = mediaApp
        this.expressApp.set("mediaApp", mediaApp)
        this.expressApp.use(express.json({type: '*/*'}));
        this.expressApp.use(express.static("./src/static"));
        this.expressApp.post('/signaling/:method', this.invokeMethod)
    }
    async invokeMethod(req, res) {
        console.log(`exec command ${req.params.method}`)
        let mediaApp = req.app.get("mediaApp")
        let room = mediaApp.getRoom(TESTROOMNAME)
        try {
            switch (req.params.method) {
                case ("sync"): {
                    let {peerId} = req.body;
                    res.send(await room.syncRemotePeer(peerId));
                    break
                }

                case ("join-as-new-peer"): {
                    let {peerId} = req.body;
                    res.send(await room.join(peerId))
                    break
                }
                case ("leave"): {
                    let {peerId} = req.body;
                    res.send(await room.leave(peerId))
                    break
                }
                case ("create-transport"): {
                    let {peerId, direction} = req.body;
                    let peer = room.findPeer(peerId)
                    res.send(await peer.crateNewTransport(direction))
                    break
                }
                case ("connect-transport"): {
                    let {peerId, transportId, dtlsParameters} = req.body
                    let peer = room.findPeer(peerId)
                    res.send(await peer.connectTransport(transportId, dtlsParameters))
                    break
                }
                case ("close-transport"): {
                    let {peerId, transportId} = req.body
                    let peer = room.findPeer(peerId)
                    res.send(await peer.closeTransport(transportId))
                    break
                }
                case ("close-producer"): {
                    let {peerId, producerId} = req.body
                    let peer = room.findPeer(peerId)
                    res.send(await peer.closeProducer(producerId))
                    break
                }
                case ("send-track"): {
                    let {
                        peerId, transportId, kind, rtpParameters,
                        paused = false, appData
                    } = req.body
                    res.send(await room.peerSendTrack(peerId, transportId, kind, rtpParameters,
                        paused = false, appData))
                    // let peer = room.findPeer(peerId)
                    // res.send(await peer.sentTrack(transportId, kind, rtpParameters, paused, appData))
                    break
                }
                case ("recv-track"): {
                    let {peerId, mediaPeerId, mediaTag, rtpCapabilities} = req.body;
                    // let peer = room.findPeer(peerId)
                    // res.send(await peer.receiveTrack(mediaPeerId, mediaTag, rtpCapabilities))
                    res.send(await room.peerReceiveTrack(peerId, mediaPeerId, mediaTag, rtpCapabilities))
                    break
                }

                case ("pause-consumer"): {
                    let {peerId, consumerId} = req.body
                    let peer = room.findPeer(peerId)
                    res.send(await peer.pauseConsumer(consumerId))
                    break
                }
                case ("resume-consumer"): {
                    let {peerId, consumerId} = req.body
                    let peer = room.findPeer(peerId)
                    res.send(await peer.resumeConsumer(consumerId))
                    break
                }
                case ("close-consumer"): {
                    let {peerId, consumerId} = req.body
                    let peer = room.findPeer(peerId)
                    res.send(await peer.closeConsumer(consumerId))
                    break
                }
                case ("consumer-set-layers"): {
                    let {peerId, consumerId, spatialLayer} = req.body
                    let peer = room.findPeer(peerId)
                    res.send(await peer.consumerSetLayers(consumerId, spatialLayer))
                    break
                }
                case ("pause-producer"): {
                    let {peerId, producerId} = req.body
                    let peer = room.findPeer(peerId)
                    res.send(await peer.pauseProducer(producerId))
                    break
                }
                case ("resume-producer"): {
                    let {peerId, producerId} = req.body
                    let peer = room.findPeer(peerId)
                    res.send(await peer.resumeProducer(producerId))
                    break
                }
            }

        } catch (e) {
            console.error(`error in /signaling/${req.params.method}`, e);
            res.send({error: e.message});
        }
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
                    console.log(`server is running and listening on ` + `https://${config.httpIp}:${config.httpPort}`);
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
    let mediaApp = new MediaApp();
    mediaApp.createNewRoom(TESTROOMNAME)
    let room = mediaApp.getRoom(TESTROOMNAME)
    let worker = await mediaApp.createWorker();
    const mediaCodecs = config.mediasoup.router.mediaCodecs;
    let router = await worker.createRouter({mediaCodecs});
    await room.createRouterAndObserver(router)
    let server = new Server(mediaApp);
    // start https server, falling back to http if https fails
    console.log('starting express');
    await server.run()

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


