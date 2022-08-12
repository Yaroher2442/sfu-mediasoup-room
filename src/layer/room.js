const Peer = require("./peer")
const config = require("../config");
const deepEqual = require("deep-equal");

class Room {
    peers = {}
    router
    audioLevelObserver
    activeSpeaker = {producerId: null, volume: null, peerId: null}

    //          CREATE
    async createRouterAndObserver(router) {
        this.router = router
        this.audioLevelObserver = await router.createAudioLevelObserver({
            interval: 800
        });
        this.audioLevelObserver.on('volumes', (volumes) => {
            const {producer, volume} = volumes[0];
            console.log('audio-level volumes event', producer.appData.peerId, volume);
            this.activeSpeaker.producerId = producer.id;
            this.activeSpeaker.volume = volume;
            this.activeSpeaker.peerId = producer.appData.peerId;
        })
        this.audioLevelObserver.on('silence', () => {
            console.log('audio-level silence event');
            this.activeSpeaker.producerId = null;
            this.activeSpeaker.volume = null;
            this.activeSpeaker.peerId = null;
        })
    }

    async createWebRtcTransport({peerId, direction}) {
        const {
            listenIps, initialAvailableOutgoingBitrate
        } = config.mediasoup.webRtcTransport;

        return await this.router.createWebRtcTransport({
            listenIps: listenIps,
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate: initialAvailableOutgoingBitrate,
            appData: {peerId, clientDirection: direction}
        });
    }

    async addProducerToAudioObserver(producerId) {
        await this.audioLevelObserver.addProducer({producerId: producerId})
    }

    //          SYNC AND UPDATE

    async syncRemotePeer(peerId) {
        // --> /signaling/sync
        //
        // client polling endpoint. send back our 'peers' data structure and
        // 'activeSpeaker' info
        //
        if (!this.peers[peerId]) {
            throw new Error('not connected');
        }
        // update our most-recently-seem timestamp -- we're not stale!
        this.peers[peerId].lastSeenTs = Date.now();
        let dumpedPeers = {}
        Object.values(this.peers).forEach((peer) => {
            dumpedPeers[peer.id] = peer.dumpSyncStatus();
        })
        return {
            peers: dumpedPeers, activeSpeaker: this.activeSpeaker
        }
    }

    async updatePeerStats() {
        // Object.entries(this.peers).forEach(([idpeer])=>{
        //     await peer.updatePeerStats();
        // })
        if (this.peers) {
            for (let {id, peer} of Object.entries(this.peers)) {
                await peer.updateStats();
            }
        }

    }

    async deleteTimeOutedPeers() {
        let now = Date.now();
        Object.entries(this.peers).forEach(([id, p]) => {
            if ((now - p.lastSeenTs) > config.httpPeerStale) {
                console.log(`removing stale peer ${id}`);
                p.close(id);
                delete this.peers[p.id]
            }
        });
    }

    //          ROUTERS

    async join(peerId) {
        // --> /signaling/join-as-new-peer
        //
        // adds the peer to the roomState data structure and creates a
        // transport that the peer will use for receiving media. returns
        // router rtpCapabilities for mediasoup-client device initialization
        //
        if (this.peers[peerId]) {
            throw Error("Already in room")
        }
        this.peers[peerId] = new Peer(peerId, this)
        return {routerRtpCapabilities: this.router.rtpCapabilities}
    }

    async leave(peerId) {
        // --> /signaling/leave
        //
        // removes the peer from the roomState data structure and and closes
        // all associated mediasoup objects
        //
        let peer = this.peers[peerId]
        if (!peer) {
            throw Error("peer not found")
        }
        await peer.close()
        delete this.peers[peerId]
        return {left: true}
    }

    async peerSendTrack(peerID, transportId, kind, rtpParameters, paused = false, appData) {
        // --> /signaling/send-track
        //
        // called from inside a client's `transport.on('produce')` event handler.
        //
        let sendedPeer = this.findPeer(peerID)
        let targetTransport
        for (let peer of Object.values(this.peers)) {
            let pee = peer._findTransport(transportId, false)
            if (pee){
                targetTransport = pee
                break
            }
        }
        if (!targetTransport) {
            throw Error(`send-track: server-side transport ${transportId} not found`)
        }
        let producer = await targetTransport.produce({
            kind, rtpParameters, paused, appData: {...appData, peerId: peerID, transportId}
        });
        producer.on('transportclose', () => {
            sendedPeer._closeProducerObject(producer);
        });
        if (producer.kind === 'audio') {
            await this.addProducerToAudioObserver(producer.id)
            // audioLevelObserver.addProducer({producerId: producer.id});
        }
        sendedPeer.producers.push(producer);
        sendedPeer.media[appData.mediaTag] = {
            paused, encodings: rtpParameters.encodings
        };
        return {id: producer.id}
    }

    async peerReceiveTrack(peerId, mediaPeerId, mediaTag, rtpCapabilities) {
        let senderPeer = this.findPeer(peerId)
        let targetPeer = this.findPeer(mediaPeerId)
        let allProducers = [...senderPeer.producers, ...targetPeer.producers]
        let targetProducer
        for (let produce of allProducers) {
            if (produce.appData.mediaTag === mediaTag && produce.appData.peerId === mediaPeerId) {
                targetProducer = produce
                break
            }
        }
        if (!targetProducer) {
            let msg = 'server-side producer for ' + `${mediaPeerId}:${mediaTag} not found`;
            throw Error('recv-track: ' + msg)
        }

        if (!this.router.canConsume({
            producerId: targetProducer.id, rtpCapabilities
        })) {
            let msg = `client cannot consume ${mediaPeerId}:${mediaTag}`;
            throw Error(`recv-track: ${peerId} ${msg}`)
        }

        let allTransports = {...senderPeer.transports, ...targetPeer.transports}
        console.log(allTransports)
        let targetTransport
        for (let trans of Object.values(allTransports)) {
            if (trans.appData.peerId === peerId && trans.appData.clientDirection === 'recv') {
                targetTransport = trans
                break
            }
        }

        if (!targetTransport) {
            let msg = `server-side recv transport for ${this.id} not found`;
            throw Error('recv-track: ' + msg)
        }

        let targetConsumer = await targetTransport.consume({
            producerId: targetProducer.id, rtpCapabilities, paused: true, // see note above about always starting paused
            appData: {peerId, mediaPeerId, mediaTag}
        });
        targetConsumer.on('transportclose', () => {
            console.log(`consumer's transport closed`, targetConsumer.id);
            senderPeer._closeConsumerObject(targetConsumer);
        });
        targetConsumer.on('producerclose', () => {
            console.log(`consumer's producer closed`, targetConsumer.id);
            senderPeer._closeConsumerObject((targetConsumer));
        });
        senderPeer.consumers.push(targetConsumer);
        senderPeer.consumerLayers[targetConsumer.id] = {
            currentLayer: null, clientSelectedLayer: null
        };
        targetConsumer.on('layerschange', (layers) => {
            console.log(`consumer layerschange ${mediaPeerId}->${peerId}`, mediaTag, layers);
            if (senderPeer.consumerLayers[targetConsumer.id]) {
                senderPeer.consumerLayers[targetConsumer.id].currentLayer = layers && layers.spatialLayer;
            }
        });
        return {
            producerId: targetProducer.id,
            id: targetConsumer.id,
            kind: targetConsumer.kind,
            rtpParameters: targetConsumer.rtpParameters,
            type: targetConsumer.type,
            producerPaused: targetConsumer.producerPaused
        }
    }

    //         HELPS
    findPeer(peerId, raise = true) {
        if (!this.peers[peerId] && raise) {
            throw Error(`Peer with id ${peerId} NOT found`)
        }
        return this.peers[peerId]
    }
}

module.exports = Room