"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resumeProducer = exports.pauseProducer = exports.consumerSetLayers = exports.closeConsumer = exports.resumeConsumer = exports.pauseConsumer = exports.receiveTrack = exports.sendTrack = exports.closeProducer = exports.closeTransport = exports.connectTransport = exports.createTransport = exports.joinNewPeer = exports.peerLeave = exports.syncData = void 0;
const index_1 = require("../index");
const config = require('../config');
const debugModule = require('debug');
const log = debugModule(`${config.appName}`);
const warn = debugModule(`${config.appName}:WARN`);
const err = debugModule(`${config.appName}:ERROR`);
const syncData = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    let { peerId } = req.body;
    try {
        // make sure this peer is connected. if we've disconnected the
        // peer because of a network outage we want the peer to know that
        // happened, when/if it returns
        if (!index_1.mediaLayer.peers.get(peerId)) {
            throw new Error('not connected');
        }
        // update our most-recently-seem timestamp -- we're not stale!
        index_1.mediaLayer.peers.get(peerId).lastSeenTs = Date.now();
        res.send({
            peers: index_1.mediaLayer.peers,
            activeSpeaker: index_1.mediaLayer.activeSpeaker
        });
    }
    catch ({ message }) {
        console.error(message);
        res.send({ error: message });
    }
});
exports.syncData = syncData;
const peerLeave = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let { peerId } = req.body;
        log('leave', peerId);
        yield index_1.mediaLayer.closePeer(peerId);
        res.send({ left: true });
    }
    catch (e) {
        console.error('error in /signaling/leave', e);
        res.send({ error: e });
    }
});
exports.peerLeave = peerLeave;
const joinNewPeer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let { peerId } = req.body, now = Date.now();
        log('join-as-new-peer', peerId);
        index_1.mediaLayer.peers.set(peerId, {
            joinTs: now,
            lastSeenTs: now,
            media: new Map(),
            consumerLayers: new Map(),
            stats: new Map()
        });
        res.send({ routerRtpCapabilities: index_1.mediaLayer.router.rtpCapabilities });
    }
    catch (e) {
        console.error('error in /signaling/join-as-new-peer', e);
        res.send({ error: e });
    }
});
exports.joinNewPeer = joinNewPeer;
const createTransport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let { peerId, direction } = req.body;
        log('create-transport', peerId, direction);
        let transport = yield index_1.mediaLayer.createWebRtcTransport(peerId, direction);
        index_1.mediaLayer.transports.set(transport.id, transport);
        let { id, iceParameters, iceCandidates, dtlsParameters } = transport;
        res.send({
            transportOptions: { id, iceParameters, iceCandidates, dtlsParameters }
        });
    }
    catch (e) {
        console.error('error in createTransport', e);
        res.send({ error: e });
    }
});
exports.createTransport = createTransport;
const connectTransport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let { peerId, transportId, dtlsParameters } = req.body, transport = index_1.mediaLayer.transports.get(transportId);
        if (!transport) {
            err(`connect-transport: server-side transport ${transportId} not found`);
            res.send({ error: `server-side transport ${transportId} not found` });
            return;
        }
        log('connect-transport', peerId, transport.appData);
        yield transport.connect({ dtlsParameters });
        res.send({ connected: true });
    }
    catch (e) {
        console.error('error in /signaling/connect-transport', e);
        res.send({ error: e });
    }
});
exports.connectTransport = connectTransport;
const closeTransport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let { peerId, transportId } = req.body, transport = index_1.mediaLayer.transports.get(transportId);
        if (!transport) {
            err(`close-transport: server-side transport ${transportId} not found`);
            res.send({ error: `server-side transport ${transportId} not found` });
            return;
        }
        log('close-transport', peerId, transport.appData);
        yield index_1.mediaLayer.closeTransport(transport);
        res.send({ closed: true });
    }
    catch (e) {
        console.error('error in /signaling/close-transport', e);
        // @ts-ignore
        res.send({ error: e.message });
    }
});
exports.closeTransport = closeTransport;
const closeProducer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let { peerId, producerId } = req.body, producer = index_1.mediaLayer.producers.find((p) => p.id === producerId);
        if (!producer) {
            err(`close-producer: server-side producer ${producerId} not found`);
            res.send({ error: `server-side producer ${producerId} not found` });
            return;
        }
        log('close-producer', peerId, producer.appData);
        yield index_1.mediaLayer.closeProducer(producer);
        res.send({ closed: true });
    }
    catch (e) {
        console.error(e);
        // @ts-ignore
        res.send({ error: e.message });
    }
});
exports.closeProducer = closeProducer;
const sendTrack = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let { peerId, transportId, kind, rtpParameters, paused = false, appData } = req.body, transport = index_1.mediaLayer.transports.get(transportId);
        if (!transport) {
            err(`send-track: server-side transport ${transportId} not found`);
            res.send({ error: `server-side transport ${transportId} not found` });
            return;
        }
        let producer = yield transport.produce({
            kind,
            rtpParameters,
            paused,
            appData: Object.assign(Object.assign({}, appData), { peerId, transportId })
        });
        // if our associated transport closes, close ourself, too
        producer.on('transportclose', () => {
            log('producer\'s transport closed', producer.id);
            index_1.mediaLayer.closeProducer(producer);
        });
        // monitor audio level of this producer. we call addProducer() here,
        // but we don't ever need to call removeProducer() because the core
        // AudioLevelObserver code automatically removes closed producers
        if (producer.kind === 'audio') {
            index_1.mediaLayer.audioLevelObserver.addProducer({ producerId: producer.id });
        }
        index_1.mediaLayer.producers.push(producer);
        index_1.mediaLayer.peers.get(peerId).media.set(appData.mediaTag, {
            paused,
            encodings: rtpParameters.encodings
        });
        res.send({ id: producer.id });
    }
    catch (e) {
    }
});
exports.sendTrack = sendTrack;
const receiveTrack = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let { peerId, mediaPeerId, mediaTag, rtpCapabilities } = req.body;
        let producer = index_1.mediaLayer.producers.find((p) => p.appData.mediaTag === mediaTag &&
            p.appData.peerId === mediaPeerId);
        if (!producer) {
            let msg = 'server-side producer for ' +
                `${mediaPeerId}:${mediaTag} not found`;
            err('recv-track: ' + msg);
            res.send({ error: msg });
            return;
        }
        if (!index_1.mediaLayer.router.canConsume({
            producerId: producer.id,
            rtpCapabilities
        })) {
            let msg = `client cannot consume ${mediaPeerId}:${mediaTag}`;
            err(`recv-track: ${peerId} ${msg}`);
            res.send({ error: msg });
            return;
        }
        let transport = Object.values(index_1.mediaLayer.transports).find((t) => t.appData.peerId === peerId && t.appData.clientDirection === 'recv');
        if (!transport) {
            let msg = `server-side recv transport for ${peerId} not found`;
            err('recv-track: ' + msg);
            res.send({ error: msg });
            return;
        }
        let consumer = yield transport.consume({
            producerId: producer.id,
            rtpCapabilities,
            paused: true,
            appData: { peerId, mediaPeerId, mediaTag }
        });
        // need both 'transportclose' and 'producerclose' event handlers,
        // to make sure we close and clean up consumers in all
        // circumstances
        consumer.on('transportclose', () => {
            log(`consumer's transport closed`, consumer.id);
            index_1.mediaLayer.closeConsumer(consumer);
        });
        consumer.on('producerclose', () => {
            log(`consumer's producer closed`, consumer.id);
            index_1.mediaLayer.closeConsumer(consumer);
        });
        // stick this consumer in our list of consumers to keep track of,
        // and create a data structure to track the client-relevant state
        // of this consumer
        index_1.mediaLayer.consumers.push(consumer);
        index_1.mediaLayer.peers.get(peerId).consumerLayers.set(consumer.id, {
            currentLayer: null,
            clientSelectedLayer: null
        });
        // update above data structure when layer changes.
        consumer.on('layerschange', (layers) => {
            log(`consumer layerschange ${mediaPeerId}->${peerId}`, mediaTag, layers);
            if (index_1.mediaLayer.peers.get(peerId) &&
                index_1.mediaLayer.peers.get(peerId).consumerLayers.get(consumer.id)) {
                index_1.mediaLayer.peers.get(peerId).consumerLayers.get(consumer.id)
                    .currentLayer = layers && layers.spatialLayer;
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
    }
    catch (e) {
        console.error('error in /signaling/recv-track', e);
        res.send({ error: e });
    }
});
exports.receiveTrack = receiveTrack;
const pauseConsumer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let { peerId, consumerId } = req.body, consumer = index_1.mediaLayer.consumers.find((c) => c.id === consumerId);
        if (!consumer) {
            err(`pause-consumer: server-side consumer ${consumerId} not found`);
            res.send({ error: `server-side producer ${consumerId} not found` });
            return;
        }
        log('pause-consumer', consumer.appData);
        yield consumer.pause();
        res.send({ paused: true });
    }
    catch (e) {
        console.error('error in /signaling/pause-consumer', e);
        res.send({ error: e });
    }
});
exports.pauseConsumer = pauseConsumer;
const resumeConsumer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let { peerId, consumerId } = req.body, consumer = index_1.mediaLayer.consumers.find((c) => c.id === consumerId);
        if (!consumer) {
            err(`pause-consumer: server-side consumer ${consumerId} not found`);
            res.send({ error: `server-side consumer ${consumerId} not found` });
            return;
        }
        log('resume-consumer', consumer.appData);
        yield consumer.resume();
        res.send({ resumed: true });
    }
    catch (e) {
        console.error('error in /signaling/resume-consumer', e);
        res.send({ error: e });
    }
});
exports.resumeConsumer = resumeConsumer;
const closeConsumer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let { peerId, consumerId } = req.body, consumer = index_1.mediaLayer.consumers.find((c) => c.id === consumerId);
        if (!consumer) {
            err(`close-consumer: server-side consumer ${consumerId} not found`);
            res.send({ error: `server-side consumer ${consumerId} not found` });
            return;
        }
        yield index_1.mediaLayer.closeConsumer(consumer);
        res.send({ closed: true });
    }
    catch (e) {
        console.error('error in /signaling/close-consumer', e);
        res.send({ error: e });
    }
});
exports.closeConsumer = closeConsumer;
const consumerSetLayers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let { peerId, consumerId, spatialLayer } = req.body, consumer = index_1.mediaLayer.consumers.find((c) => c.id === consumerId);
        if (!consumer) {
            err(`consumer-set-layers: server-side consumer ${consumerId} not found`);
            res.send({ error: `server-side consumer ${consumerId} not found` });
            return;
        }
        log('consumer-set-layers', spatialLayer, consumer.appData);
        yield consumer.setPreferredLayers({ spatialLayer });
        res.send({ layersSet: true });
    }
    catch (e) {
        console.error('error in /signaling/consumer-set-layers', e);
        res.send({ error: e });
    }
});
exports.consumerSetLayers = consumerSetLayers;
const pauseProducer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let { peerId, producerId } = req.body, producer = index_1.mediaLayer.producers.find((p) => p.id === producerId);
        if (!producer) {
            err(`pause-producer: server-side producer ${producerId} not found`);
            res.send({ error: `server-side producer ${producerId} not found` });
            return;
        }
        log('pause-producer', producer.appData);
        yield producer.pause();
        index_1.mediaLayer.peers.get(peerId).media.get(producer.appData.mediaTag).paused = true;
        res.send({ paused: true });
    }
    catch (e) {
        console.error('error in /signaling/pause-producer', e);
        res.send({ error: e });
    }
});
exports.pauseProducer = pauseProducer;
const resumeProducer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let { peerId, producerId } = req.body, producer = index_1.mediaLayer.producers.find((p) => p.id === producerId);
        if (!producer) {
            err(`resume-producer: server-side producer ${producerId} not found`);
            res.send({ error: `server-side producer ${producerId} not found` });
            return;
        }
        log('resume-producer', producer.appData);
        yield producer.resume();
        index_1.mediaLayer.peers.get(peerId).media.get(producer.appData.mediaTag).paused = false;
        res.send({ resumed: true });
    }
    catch (e) {
        console.error('error in /signaling/resume-producer', e);
        res.send({ error: e });
    }
});
exports.resumeProducer = resumeProducer;
