import {Worker} from "mediasoup/node/lib/Worker";
import {Router} from "mediasoup/node/lib/Router";
import {AudioLevelObserver} from "mediasoup/node/lib/AudioLevelObserver";
import {WebRtcTransport, WebRtcTransportListenServer} from "mediasoup/node/lib/WebRtcTransport";
import {Producer, ProducerStat} from "mediasoup/node/lib/Producer";
import {Consumer, ConsumerStat} from "mediasoup/node/lib/Consumer";
import {config} from "../config";
import {RtpCodecCapability} from "mediasoup/node/lib/RtpParameters";
import {Transport} from "mediasoup/node/lib/Transport";
import debugModule from "debug";

const mediasoup = require('mediasoup');
const log = debugModule(`${config.appName}`);
const warn = debugModule(`${config.appName}:WARN`);
const err = debugModule(`${config.appName}:ERROR`);

class Peer {
    joinTs?: number;
    lastSeenTs?: number;
    media: Map<any, any> = new Map<any, any>();
    consumerLayers: Map<any, any> = new Map<any, any>();
    stats: Map<string, ProducerStat[] | ConsumerStat> = new Map<string, ProducerStat[] | ConsumerStat>();
}

export class Layer {
    peers: Map<string, Peer> = new Map<string, Peer>();
    activeSpeaker: { producerId: string | null, volume: number | null, peerId: string | null } =
        {
            producerId: null,
            volume: null,
            peerId: null
        }
    // internal
    transports: Map<string, WebRtcTransport> = new Map<string, WebRtcTransport>();
    producers: Producer[] = [];
    consumers: Consumer[] = [];
    worker?: Worker;
    router?: Router;
    audioLevelObserver?: AudioLevelObserver

    constructor() {
        this.consumers = [];
        this.producers = [];
        this.updatePeerStats = this.updatePeerStats.bind(this);
    }

    async createWorker(): Promise<Worker> {
        let worker = await mediasoup.createWorker({
            logLevel: config.mediasoup.worker.logLevel,
            logTags: config.mediasoup.worker.logTags,
            rtcMinPort: config.mediasoup.worker.rtcMinPort,
            rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
        });
        worker.on('died', () => {
            console.error('mediasoup worker died (this should never happen)');
            process.exit(1);
        });

        return worker;
    }

    async createRouter(worker: Worker): Promise<Router> {
        const mediaCodecs = config.mediasoup.router.mediaCodecs as unknown as RtpCodecCapability[];
        return await worker.createRouter({mediaCodecs});
    }

    async createAudioObserver(router: Router): Promise<AudioLevelObserver> {
        let audioLevelObserver = await router.createAudioLevelObserver({
            interval: 800
        });
        audioLevelObserver.on('volumes', (volumes: { producer: any; volume: any; }[]) => {
            const {producer, volume} = volumes[0];
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

    async closeTransport(transport: Transport): Promise<void> {
        try {
            log('closing transport', transport.id, transport.appData);

            // our producer and consumer event handlers will take care of
            // calling closeProducer() and closeConsumer() on all the producers
            // and consumers associated with this transport
            await transport.close();

            // so all we need to do, after we call transport.close(), is update
            // our roomState data structure
            this.transports.delete(transport.id);
        } catch (e) {
            err(e);
        }
    }

    async closeProducer(producer: Producer): Promise<void> {
        log('closing producer', producer.id, producer.appData);
        try {
            await producer.close();

            // remove this producer from our roomState.producers list
            this.producers = this.producers
                .filter((p) => p.id !== producer.id);

            // remove this track's info from our roomState...mediaTag bookkeeping
            let peerId = producer.appData.peerId as string;
            if (this.peers.get(peerId)) {
                this.peers.get(peerId)!.media.delete(producer.appData.mediaTag);
            }
        } catch (e) {
            err(e);
        }
    }

    async closeConsumer(consumer: Consumer): Promise<void> {
        log('closing consumer', consumer.id, consumer.appData);
        await consumer.close();

        // remove this consumer from our roomState.consumers list
        this.consumers = this.consumers.filter((c) => c.id !== consumer.id);

        // remove layer info from from our roomState...consumerLayers bookkeeping
        let peerId = consumer.appData.peerId as string;
        if (this.peers.get(peerId)) {
            this.peers.get(peerId)!.consumerLayers.delete(consumer.id);
        }
    }


    async createWebRtcTransport(peerId: string, direction: string) {
        const {
            listenIps,
            initialAvailableOutgoingBitrate
        } = config.mediasoup.webRtcTransport;

        // @ts-ignore
        let ips = listenIps as WebRtcTransportOptions;
        return await this.router!.createWebRtcTransport({
            listenIps:ips,
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate: initialAvailableOutgoingBitrate,
            appData: {peerId, clientDirection: direction}
        });
    }

    async startLayer(): Promise<void> {
        this.worker = await this.createWorker();
        this.router = await this.createRouter(this.worker);
        this.audioLevelObserver = await this.createAudioObserver(this.router);
    }

    setTimedTask() {
        setInterval(() => {
            let now = Date.now();
            Object.entries(this.peers).forEach(([id, p]) => {
                if ((now - p.lastSeenTs) > config.httpPeerStale) {
                    warn(`removing stale peer ${id}`);
                    this.closePeer(id);
                }
            });
        }, 1000);

        // periodically update video stats we're sending to peers
        setInterval(this.updatePeerStats, 3000);
    }

    async updatePeerStats(): Promise<void> {
        for (let producer of this.producers) {
            if (producer.kind !== 'video') {
                continue;
            }
            try {
                let stats = await producer.getStats(),
                    peerId = producer.appData.peerId as string;
                this.peers.get(peerId)!.stats.set(producer.id, stats)
            } catch (e) {
                warn('error while updating producer stats', e);
            }
        }
        for (let consumer of this.consumers) {
            try {
                let stats = (await consumer.getStats())
                        .find((s) => s.type === 'outbound-rtp'),
                    peerId = consumer.appData.peerId as string;
                if (!stats || !this.peers.get(peerId)) {
                    continue;
                }
                this.peers.get(peerId)!.stats.set(consumer.id, stats)
            } catch (e) {
                warn('error while updating consumer stats', e);
            }
        }
    }

    closePeer(peerId: string) {
        peerId = peerId as string;
        log('closing peer', peerId);
        for (let [id, transport] of Object.entries(this.transports)) {
            if (transport.appData.peerId === peerId) {
                this.closeTransport(transport);
            }
        }
        this.peers.delete(peerId)
    }

}

