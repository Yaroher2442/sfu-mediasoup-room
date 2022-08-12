const Peer = require("./peer")
class Room {
    peers = {}
    router = null
    audioLevelObserver = null
    activeSpeaker = {producerId: null, volume: null, peerId: null}

    async createRouterAndObserver(router) {
        this.router = router

        this.audioLevelObserver = await router.createAudioLevelObserver({
            interval: 800
        });
        this.audioLevelObserver.on('volumes', this.audioObserverOnVolumes)
        this.audioLevelObserver.on('silence', this.audioObserverOnSilence)
    }

    audioObserverOnVolumes(volumes) {
        const {producer, volume} = volumes[0];
        console.log('audio-level volumes event', producer.appData.peerId, volume);
        this.activeSpeaker.producerId = producer.id;
        this.activeSpeaker.volume = volume;
        this.activeSpeaker.peerId = producer.appData.peerId;
    }

    audioObserverOnSilence() {
        console.log('audio-level silence event');
        this.activeSpeaker.producerId = null;
        this.activeSpeaker.volume = null;
        this.activeSpeaker.peerId = null;
    }


    async join(peerId) {
        this.peers[peerId] = new Peer()
    }

    async leave(peerId) {
        delete this.peers[peerId]
    }
}

module.exports = Room