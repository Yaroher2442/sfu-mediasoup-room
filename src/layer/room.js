const Peer = require("./peer")
const config = require("../config");

class Room {
    peers = {}
    router
    audioLevelObserver
    activeSpeaker = {producerId: null, volume: null, peerId: null}

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
        if (!peer){
            throw Error("peer not found")
        }
        await peer.close()
        delete this.peers[peerId]
        return {left: true}
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

    findPeer(peerId) {
        return this.peers[peerId]
    }
}

module.exports = Room