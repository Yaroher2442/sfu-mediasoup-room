"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Layer = void 0;
const config_1 = require("../config");
const debug_1 = __importDefault(require("debug"));
const mediasoup = require('mediasoup');
const log = (0, debug_1.default)(`${config_1.config.appName}`);
const warn = (0, debug_1.default)(`${config_1.config.appName}:WARN`);
const err = (0, debug_1.default)(`${config_1.config.appName}:ERROR`);
class Peer {
    constructor() {
        this.media = new Map();
        this.consumerLayers = new Map();
        this.stats = new Map();
    }
}
class Layer {
    constructor() {
        this.peers = new Map();
        this.activeSpeaker = {
            producerId: null,
            volume: null,
            peerId: null
        };
        // internal
        this.transports = new Map();
        this.producers = [];
        this.consumers = [];
        this.consumers = [];
        this.producers = [];
        this.updatePeerStats = this.updatePeerStats.bind(this);
    }
    async createWorker() {
        let worker = await mediasoup.createWorker({
            logLevel: config_1.config.mediasoup.worker.logLevel,
            logTags: config_1.config.mediasoup.worker.logTags,
            rtcMinPort: config_1.config.mediasoup.worker.rtcMinPort,
            rtcMaxPort: config_1.config.mediasoup.worker.rtcMaxPort,
        });
        worker.on('died', () => {
            console.error('mediasoup worker died (this should never happen)');
            process.exit(1);
        });
        return worker;
    }
    async createRouter(worker) {
        const mediaCodecs = config_1.config.mediasoup.router.mediaCodecs;
        return await worker.createRouter({ mediaCodecs });
    }
    async createAudioObserver(router) {
        let audioLevelObserver = await router.createAudioLevelObserver({
            interval: 800
        });
        audioLevelObserver.on('volumes', (volumes) => {
            const { producer, volume } = volumes[0];
            log('audio-level volumes event', producer.appData.peerId, volume);
            this.activeSpeaker.producerId = producer.id;
            this.activeSpeaker.volume = volume;
            this.activeSpeaker.peerId = producer.appData.peerId;
        });
        audioLevelObserver.on('silence', () => {
            log('audio-level silence event');
            this.activeSpeaker.producerId = null;
            this.activeSpeaker.volume = null;
            this.activeSpeaker.peerId = null;
        });
        return audioLevelObserver;
    }
    async closeTransport(transport) {
        try {
            log('closing transport', transport.id, transport.appData);
            // our producer and consumer event handlers will take care of
            // calling closeProducer() and closeConsumer() on all the producers
            // and consumers associated with this transport
            await transport.close();
            // so all we need to do, after we call transport.close(), is update
            // our roomState data structure
            this.transports.delete(transport.id);
        }
        catch (e) {
            err(e);
        }
    }
    async closeProducer(producer) {
        log('closing producer', producer.id, producer.appData);
        try {
            await producer.close();
            // remove this producer from our roomState.producers list
            this.producers = this.producers
                .filter((p) => p.id !== producer.id);
            // remove this track's info from our roomState...mediaTag bookkeeping
            let peerId = producer.appData.peerId;
            if (this.peers.get(peerId)) {
                this.peers.get(peerId).media.delete(producer.appData.mediaTag);
            }
        }
        catch (e) {
            err(e);
        }
    }
    async closeConsumer(consumer) {
        log('closing consumer', consumer.id, consumer.appData);
        await consumer.close();
        // remove this consumer from our roomState.consumers list
        this.consumers = this.consumers.filter((c) => c.id !== consumer.id);
        // remove kernel info from from our roomState...consumerLayers bookkeeping
        let peerId = consumer.appData.peerId;
        if (this.peers.get(peerId)) {
            this.peers.get(peerId).consumerLayers.delete(consumer.id);
        }
    }
    async createWebRtcTransport(peerId, direction) {
        const { listenIps, initialAvailableOutgoingBitrate } = config_1.config.mediasoup.webRtcTransport;
        // @ts-ignore
        let ips = listenIps;
        return await this.router.createWebRtcTransport({
            listenIps: ips,
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate: initialAvailableOutgoingBitrate,
            appData: { peerId, clientDirection: direction }
        });
    }
    async startLayer() {
        this.worker = await this.createWorker();
        this.router = await this.createRouter(this.worker);
        this.audioLevelObserver = await this.createAudioObserver(this.router);
    }
    setTimedTask() {
        setInterval(() => {
            let now = Date.now();
            Object.entries(this.peers).forEach(([id, p]) => {
                if ((now - p.lastSeenTs) > config_1.config.httpPeerStale) {
                    warn(`removing stale peer ${id}`);
                    this.closePeer(id);
                }
            });
        }, 1000);
        // periodically update video stats we're sending to peers
        setInterval(this.updatePeerStats, 3000);
    }
    async updatePeerStats() {
        for (let producer of this.producers) {
            if (producer.kind !== 'video') {
                continue;
            }
            try {
                let stats = await producer.getStats(), peerId = producer.appData.peerId;
                this.peers.get(peerId).stats.set(producer.id, stats);
            }
            catch (e) {
                warn('error while updating producer stats', e);
            }
        }
        for (let consumer of this.consumers) {
            try {
                let stats = (await consumer.getStats())
                    .find((s) => s.type === 'outbound-rtp'), peerId = consumer.appData.peerId;
                if (!stats || !this.peers.get(peerId)) {
                    continue;
                }
                this.peers.get(peerId).stats.set(consumer.id, stats);
            }
            catch (e) {
                warn('error while updating consumer stats', e);
            }
        }
    }
    closePeer(peerId) {
        peerId = peerId;
        log('closing peer', peerId);
        for (let [id, transport] of Object.entries(this.transports)) {
            if (transport.appData.peerId === peerId) {
                this.closeTransport(transport);
            }
        }
        this.peers.delete(peerId);
    }
}
exports.Layer = Layer;
