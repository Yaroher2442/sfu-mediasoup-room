const Peer = require("./peer")

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

    async join(peerId) {
        this.peers[peerId] = new Peer()
    }

    async leave(peerId) {
        delete this.peers[peerId]
    }
}

module.exports = Room