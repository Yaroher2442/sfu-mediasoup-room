const config = require('./config');
const mediasoup = require('mediasoup');
const express = require('express');
const https = require('https');
const fs = require('fs');
const Room = require("./layer/room")
const {observer} = require("mediasoup");

let httpsServer;

// one mediasoup worker and router
//
let worker, router, audioLevelObserver, room;

//
// and one "room" ...
//
const roomState = {
    // external
    peers: {}, activeSpeaker: {producerId: null, volume: null, peerId: null}, // internal
    transports: {}, producers: [], consumers: []
}
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


//
// main() -- our execution entry point
//

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
}


class Server {
    expressApp = express();
    mediaApp

    constructor(mediaApp) {
        this.mediaApp = mediaApp
        this.expressApp.set()
        this.expressApp.use(express.json({type: '*/*'}));
        this.expressApp.use(express.static("./src/static"));
        this.addRoutes()
    }

    addRoutes() {
        this.expressApp.post('/signaling/sync', sync);
        this.expressApp.post('/signaling/join-as-new-peer', join);
        this.expressApp.post('/signaling/leave', leave);
        this.expressApp.post('/signaling/create-transport', crateNewTransport);
        this.expressApp.post('/signaling/connect-transport', connectTransport);
        this.expressApp.post('/signaling/close-transport', closeRouteTransport)
        this.expressApp.post('/signaling/close-producer', closeRouteProducer);
        this.expressApp.post('/signaling/send-track', sentTrack);
        this.expressApp.post('/signaling/recv-track', receiveTrack);
        this.expressApp.post('/signaling/pause-consumer', pauseConsumer);
        this.expressApp.post('/signaling/resume-consumer', resumeConsumer);
        this.expressApp.post('/signaling/close-consumer', closeRouteConsumer)
        this.expressApp.post('/signaling/consumer-set-layers', consumerSetLayers);
        this.expressApp.post('/signaling/pause-producer', pauseProducer);
        this.expressApp.post('/signaling/resume-producer', resumeProducer);
    }

    async invokeMethod(commandPath, req, res) {
        console.log(`exec command path ${commandPath}`)
        try {
            switch (commandPath) {
                case ("sync"):
                    console.log(`exec command path ${commandPath}`)
                    let {peerId} = req.body, now = Date.now();
                    console.log('join-as-new-peer', peerId);
                    roomState.peers[peerId] = {
                        joinTs: now, lastSeenTs: now, media: {}, consumerLayers: {}, stats: {}
                    };
                    await room.join(peerId)
                    res.send({routerRtpCapabilities: router.rtpCapabilities})
            }
        } catch (e) {
            console.error('error in /signaling/join-as-new-peer', e);
            res.send({error: e.message});
        }
    }

    async run() {
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
    mediaApp = new MediaApp();

    ({worker, router, audioLevelObserver, room} = await startMediasoup(mediaApp));
    console.log({worker, router, audioLevelObserver, room})
    let server = new Server(mediaApp);
    // start https server, falling back to http if https fails
    console.log('starting express');
    await server.run()

    // periodically clean up peers that disconnected without sending us
    // a final "beacon"
    setInterval(() => {
        let now = Date.now();
        Object.entries(roomState.peers).forEach(([id, p]) => {
            if ((now - p.lastSeenTs) > config.httpPeerStale) {
                console.log(`removing stale peer ${id}`);
                closePeer(id);
            }
        });
    }, 1000);

    // periodically update video stats we're sending to peers
    setInterval(updatePeerStats, 3000);
}

main();


//
// start mediasoup with a single worker and router
//
async function startMediasoup(mediaApp) {
    room = new Room()
    worker = await mediaApp.createWorker();
    const mediaCodecs = config.mediasoup.router.mediaCodecs;
    router = await worker.createRouter({mediaCodecs});
    await room.createRouterAndObserver(router)
    console.log(room.audioLevelObserver)
    return {worker, router, audioLevelObserver: room.audioLevelObserver, room};
}

// async function startMediasoup() {
//     let worker = await mediasoup.createWorker({
//         logLevel: config.mediasoup.worker.logLevel,
//         logTags: config.mediasoup.worker.logTags,
//         rtcMinPort: config.mediasoup.worker.rtcMinPort,
//         rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
//     });
//
//     worker.on('died', () => {
//         console.error('mediasoup worker died (this should never happen)');
//         process.exit(1);
//     });
//
//     const mediaCodecs = config.mediasoup.router.mediaCodecs;
//     const router = await worker.createRouter({mediaCodecs});
//
//     // audioLevelObserver for signaling active speaker
//     //
//     const audioLevelObserver = await router.createAudioLevelObserver({
//         interval: 800
//     });
//     audioLevelObserver.on('volumes', (volumes) => {
//         console.log("saaaaaaaaaaaaaaaaaaaaaaaaaaa")
//         const {producer, volume} = volumes[0];
//         console.log('audio-level volumes event', producer.appData.peerId, volume);
//         roomState.activeSpeaker.producerId = producer.id;
//         roomState.activeSpeaker.volume = volume;
//         roomState.activeSpeaker.peerId = producer.appData.peerId;
//     });
//     audioLevelObserver.on('silence', () => {
//         console.log('audio-level silence event');
//         roomState.activeSpeaker.producerId = null;
//         roomState.activeSpeaker.volume = null;
//         roomState.activeSpeaker.peerId = null;
//     });
//
//     return {worker, router, audioLevelObserver};
// }

//
// stats
//

async function updatePeerStats() {
    for (let producer of roomState.producers) {
        if (producer.kind !== 'video') {
            continue;
        }
        try {
            let stats = await producer.getStats(), peerId = producer.appData.peerId;
            roomState.peers[peerId].stats[producer.id] = stats.map((s) => ({
                bitrate: s.bitrate, fractionLost: s.fractionLost, jitter: s.jitter, score: s.score, rid: s.rid
            }));
        } catch (e) {
            console.log('error while updating producer stats', e);
        }
    }

    for (let consumer of roomState.consumers) {
        try {
            let stats = (await consumer.getStats())
                .find((s) => s.type === 'outbound-rtp'), peerId = consumer.appData.peerId;
            if (!stats || !roomState.peers[peerId]) {
                continue;
            }
            roomState.peers[peerId].stats[consumer.id] = [{
                bitrate: stats.bitrate, fractionLost: stats.fractionLost, score: stats.score
            }]
        } catch (e) {
            console.log('error while updating consumer stats', e);
        }
    }
}

function closePeer(peerId) {
    console.log('closing peer', peerId);
    for (let [id, transport] of Object.entries(roomState.transports)) {
        if (transport.appData.peerId === peerId) {
            closeTransport(transport);
        }
    }
    delete roomState.peers[peerId];
}


async function createWebRtcTransport({peerId, direction}) {
    const {
        listenIps, initialAvailableOutgoingBitrate
    } = config.mediasoup.webRtcTransport;

    return await router.createWebRtcTransport({
        listenIps: listenIps,
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: initialAvailableOutgoingBitrate,
        appData: {peerId, clientDirection: direction}
    });
}

async function closeTransport(transport) {
    try {
        console.log('closing transport', transport.id, transport.appData);

        // our producer and consumer event handlers will take care of
        // calling closeProducer() and closeConsumer() on all the producers
        // and consumers associated with this transport
        await transport.close();

        // so all we need to do, after we call transport.close(), is update
        // our roomState data structure
        delete roomState.transports[transport.id];
    } catch (e) {
        console.error(e);
    }
}

async function closeProducer(producer) {
    console.log('closing producer', producer.id, producer.appData);
    try {
        await producer.close();

        // remove this producer from our roomState.producers list
        roomState.producers = roomState.producers
            .filter((p) => p.id !== producer.id);

        // remove this track's info from our roomState...mediaTag bookkeeping
        if (roomState.peers[producer.appData.peerId]) {
            delete (roomState.peers[producer.appData.peerId].media[producer.appData.mediaTag]);
        }
    } catch (e) {
        console.error(e);
    }
}

async function closeConsumer(consumer) {
    console.log('closing consumer', consumer.id, consumer.appData);
    await consumer.close();

    // remove this consumer from our roomState.consumers list
    roomState.consumers = roomState.consumers.filter((c) => c.id !== consumer.id);

    // remove layer info from from our roomState...consumerLayers bookkeeping
    if (roomState.peers[consumer.appData.peerId]) {
        delete roomState.peers[consumer.appData.peerId].consumerLayers[consumer.id];
    }
}

// -------------------------------------------------------------------------------------------------------------------
//                                                          HANDLERS
// -------------------------------------------------------------------------------------------------------------------

//
// -- our minimal signaling is just http polling --
//


// --> /signaling/sync
//
// client polling endpoint. send back our 'peers' data structure and
// 'activeSpeaker' info
//
async function sync(req, res) {
    let {peerId} = req.body;
    try {
        // make sure this peer is connected. if we've disconnected the
        // peer because of a network outage we want the peer to know that
        // happened, when/if it returns
        if (!roomState.peers[peerId]) {
            throw new Error('not connected');
        }

        // update our most-recently-seem timestamp -- we're not stale!
        roomState.peers[peerId].lastSeenTs = Date.now();
        let rps = {
            peers: roomState.peers, activeSpeaker: roomState.activeSpeaker
        }
        console.log(rps)
        res.send(rps);
    } catch (e) {
        console.error(e.message);
        res.send({error: e.message});
    }
}


// --> /signaling/join-as-new-peer
//
// adds the peer to the roomState data structure and creates a
// transport that the peer will use for receiving media. returns
// router rtpCapabilities for mediasoup-client device initialization
//
async function join(req, res) {
    try {
        let {peerId} = req.body, now = Date.now();
        console.log('join-as-new-peer', peerId);

        roomState.peers[peerId] = {
            joinTs: now, lastSeenTs: now, media: {}, consumerLayers: {}, stats: {}
        };
        // TODO:ROOM
        // await room.join(peerId)
        res.send({routerRtpCapabilities: router.rtpCapabilities});
    } catch (e) {
        console.error('error in /signaling/join-as-new-peer', e);
        res.send({error: e.message});
    }
}


// --> /signaling/leave
//
// removes the peer from the roomState data structure and and closes
// all associated mediasoup objects
//
async function leave(req, res) {
    try {
        let {peerId} = req.body;
        console.log('leave', peerId);

        await closePeer(peerId);
        res.send({left: true});
    } catch (e) {
        console.error('error in /signaling/leave', e);
        res.send({error: e.message});
    }
}


// --> /signaling/create-transport
//
// create a mediasoup transport object and send back info needed
// to create a transport object on the client side
//
async function crateNewTransport(req, res) {
    try {
        let {peerId, direction} = req.body;
        console.log('create-transport', peerId, direction);

        let transport = await createWebRtcTransport({peerId, direction});
        roomState.transports[transport.id] = transport;

        let {id, iceParameters, iceCandidates, dtlsParameters} = transport;
        res.send({
            transportOptions: {id, iceParameters, iceCandidates, dtlsParameters}
        });
    } catch (e) {
        console.error('error in /signaling/create-transport', e);
        res.send({error: e.message});
    }
}


// --> /signaling/connect-transport
//
// called from inside a client's `transport.on('connect')` event
// handler.
//
async function connectTransport(req, res) {
    try {
        let {peerId, transportId, dtlsParameters} = req.body, transport = roomState.transports[transportId];

        if (!transport) {
            console.error(`connect-transport: server-side transport ${transportId} not found`);
            res.send({error: `server-side transport ${transportId} not found`});
            return;
        }

        console.log('connect-transport', peerId, transport.appData);

        await transport.connect({dtlsParameters});
        res.send({connected: true});
    } catch (e) {
        console.error('error in /signaling/connect-transport', e);
        res.send({error: e.message});
    }
}


// --> /signaling/close-transport
//
// called by a client that wants to close a single transport (for
// example, a client that is no longer sending any media).
//
async function closeRouteTransport(req, res) {
    try {
        let {peerId, transportId} = req.body, transport = roomState.transports[transportId];

        if (!transport) {
            console.error(`close-transport: server-side transport ${transportId} not found`);
            res.send({error: `server-side transport ${transportId} not found`});
            return;
        }

        console.log('close-transport', peerId, transport.appData);

        await closeTransport(transport);
        res.send({closed: true});
    } catch (e) {
        console.error('error in /signaling/close-transport', e);
        res.send({error: e.message});
    }
}

// --> /signaling/close-producer
//
// called by a client that is no longer sending a specific track
//
async function closeRouteProducer(req, res) {
    try {
        let {peerId, producerId} = req.body, producer = roomState.producers.find((p) => p.id === producerId);

        if (!producer) {
            console.error(`close-producer: server-side producer ${producerId} not found`);
            res.send({error: `server-side producer ${producerId} not found`});
            return;
        }

        console.log('close-producer', peerId, producer.appData);

        await closeProducer(producer);
        res.send({closed: true});
    } catch (e) {
        console.error(e);
        res.send({error: e.message});
    }
}


// --> /signaling/send-track
//
// called from inside a client's `transport.on('produce')` event handler.
//
async function sentTrack(req, res) {
    try {
        let {
            peerId, transportId, kind, rtpParameters, paused = false, appData
        } = req.body, transport = roomState.transports[transportId];

        if (!transport) {
            console.error(`send-track: server-side transport ${transportId} not found`);
            res.send({error: `server-side transport ${transportId} not found`});
            return;
        }

        let producer = await transport.produce({
            kind, rtpParameters, paused, appData: {...appData, peerId, transportId}
        });

        // if our associated transport closes, close ourself, too
        producer.on('transportclose', () => {
            console.log('producer\'s transport closed', producer.id);
            closeProducer(producer);
        });

        // monitor audio level of this producer. we call addProducer() here,
        // but we don't ever need to call removeProducer() because the core
        // AudioLevelObserver code automatically removes closed producers
        if (producer.kind === 'audio') {
            audioLevelObserver.addProducer({producerId: producer.id});
        }

        roomState.producers.push(producer);
        roomState.peers[peerId].media[appData.mediaTag] = {
            paused, encodings: rtpParameters.encodings
        };

        res.send({id: producer.id});
    } catch (e) {
        res.send({error: e.message});
    }
}


// --> /signaling/recv-track
//
// create a mediasoup consumer object, hook it up to a producer here
// on the server side, and send back info needed to create a consumer
// object on the client side. always start consumers paused. client
// will request media to resume when the connection completes
//
async function receiveTrack(req, res) {
    try {
        let {peerId, mediaPeerId, mediaTag, rtpCapabilities} = req.body;

        let producer = roomState.producers.find((p) => p.appData.mediaTag === mediaTag && p.appData.peerId === mediaPeerId);

        if (!producer) {
            let msg = 'server-side producer for ' + `${mediaPeerId}:${mediaTag} not found`;
            console.error('recv-track: ' + msg);
            res.send({error: msg});
            return;
        }

        if (!router.canConsume({
            producerId: producer.id, rtpCapabilities
        })) {
            let msg = `client cannot consume ${mediaPeerId}:${mediaTag}`;
            console.error(`recv-track: ${peerId} ${msg}`);
            res.send({error: msg});
            return;
        }

        let transport = Object.values(roomState.transports).find((t) => t.appData.peerId === peerId && t.appData.clientDirection === 'recv');

        if (!transport) {
            let msg = `server-side recv transport for ${peerId} not found`;
            console.error('recv-track: ' + msg);
            res.send({error: msg});
            return;
        }

        let consumer = await transport.consume({
            producerId: producer.id, rtpCapabilities, paused: true, // see note above about always starting paused
            appData: {peerId, mediaPeerId, mediaTag}
        });

        // need both 'transportclose' and 'producerclose' event handlers,
        // to make sure we close and clean up consumers in all
        // circumstances
        consumer.on('transportclose', () => {
            console.log(`consumer's transport closed`, consumer.id);
            closeConsumer(consumer);
        });
        consumer.on('producerclose', () => {
            console.log(`consumer's producer closed`, consumer.id);
            closeConsumer(consumer);
        });

        // stick this consumer in our list of consumers to keep track of,
        // and create a data structure to track the client-relevant state
        // of this consumer
        roomState.consumers.push(consumer);
        roomState.peers[peerId].consumerLayers[consumer.id] = {
            currentLayer: null, clientSelectedLayer: null
        };

        // update above data structure when layer changes.
        consumer.on('layerschange', (layers) => {
            console.log(`consumer layerschange ${mediaPeerId}->${peerId}`, mediaTag, layers);
            if (roomState.peers[peerId] && roomState.peers[peerId].consumerLayers[consumer.id]) {
                roomState.peers[peerId].consumerLayers[consumer.id].currentLayer = layers && layers.spatialLayer;
            }
        });

        res.send({
            producerId: producer.id,
            id: consumer.id,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            type: consumer.type,
            producerPaused: consumer.producerPaused
        });
    } catch (e) {
        console.error('error in /signaling/recv-track', e);
        res.send({error: e.message});
    }
}


// --> /signaling/pause-consumer
//
// called to pause receiving a track for a specific client
//
async function pauseConsumer(req, res) {
    try {
        let {peerId, consumerId} = req.body, consumer = roomState.consumers.find((c) => c.id === consumerId);

        if (!consumer) {
            console.error(`pause-consumer: server-side consumer ${consumerId} not found`);
            res.send({error: `server-side producer ${consumerId} not found`});
            return;
        }

        console.log('pause-consumer', consumer.appData);

        await consumer.pause();

        res.send({paused: true});
    } catch (e) {
        console.error('error in /signaling/pause-consumer', e);
        res.send({error: e.message});
    }

}


// --> /signaling/resume-consumer
//
// called to resume receiving a track for a specific client
//
async function resumeConsumer(req, res) {
    try {
        let {peerId, consumerId} = req.body, consumer = roomState.consumers.find((c) => c.id === consumerId);

        if (!consumer) {
            console.error(`pause-consumer: server-side consumer ${consumerId} not found`);
            res.send({error: `server-side consumer ${consumerId} not found`});
            return;
        }

        console.log('resume-consumer', consumer.appData);

        await consumer.resume();

        res.send({resumed: true});
    } catch (e) {
        console.error('error in /signaling/resume-consumer', e);
        res.send({error: e.message});
    }
}


// --> /signalign/close-consumer
//
// called to stop receiving a track for a specific client. close and
// clean up consumer object
//
async function closeRouteConsumer(req, res) {
    try {
        let {peerId, consumerId} = req.body, consumer = roomState.consumers.find((c) => c.id === consumerId);

        if (!consumer) {
            console.error(`close-consumer: server-side consumer ${consumerId} not found`);
            res.send({error: `server-side consumer ${consumerId} not found`});
            return;
        }

        await closeConsumer(consumer);

        res.send({closed: true});
    } catch (e) {
        console.error('error in /signaling/close-consumer', e);
        res.send({error: e.message});
    }
}


// --> /signaling/consumer-set-layers
//
// called to set the largest spatial layer that a specific client
// wants to receive
//
async function consumerSetLayers(req, res) {
    try {
        let {peerId, consumerId, spatialLayer} = req.body,
            consumer = roomState.consumers.find((c) => c.id === consumerId);

        if (!consumer) {
            console.error(`consumer-set-layers: server-side consumer ${consumerId} not found`);
            res.send({error: `server-side consumer ${consumerId} not found`});
            return;
        }

        console.log('consumer-set-layers', spatialLayer, consumer.appData);

        await consumer.setPreferredLayers({spatialLayer});

        res.send({layersSet: true});
    } catch (e) {
        console.error('error in /signaling/consumer-set-layers', e);
        res.send({error: e.message});
    }
}


// --> /signaling/pause-producer
//
// called to stop sending a track from a specific client
//
async function pauseProducer(req, res) {
    try {
        let {peerId, producerId} = req.body, producer = roomState.producers.find((p) => p.id === producerId);

        if (!producer) {
            console.error(`pause-producer: server-side producer ${producerId} not found`);
            res.send({error: `server-side producer ${producerId} not found`});
            return;
        }

        console.log('pause-producer', producer.appData);

        await producer.pause();

        roomState.peers[peerId].media[producer.appData.mediaTag].paused = true;

        res.send({paused: true});
    } catch (e) {
        console.error('error in /signaling/pause-producer', e);
        res.send({error: e.message});
    }
}


// --> /signaling/resume-producer
//
// called to resume sending a track from a specific client
//
async function resumeProducer(req, res) {
    try {
        let {peerId, producerId} = req.body, producer = roomState.producers.find((p) => p.id === producerId);

        if (!producer) {
            console.error(`resume-producer: server-side producer ${producerId} not found`);
            res.send({error: `server-side producer ${producerId} not found`});
            return;
        }

        console.log('resume-producer', producer.appData);

        await producer.resume();

        roomState.peers[peerId].media[producer.appData.mediaTag].paused = false;

        res.send({resumed: true});
    } catch (e) {
        console.error('error in /signaling/resume-producer', e);
        res.send({error: e.message});
    }
}


