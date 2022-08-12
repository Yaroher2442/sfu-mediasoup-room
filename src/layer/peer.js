class Peer {
    joinTs = null
    lastSeenTs = null
    media = {}
    consumerLayers = {}
    stats = {}

    constructor(peerId) {
        this.joinTs = Date.now()
        this.lastSeenTs = Date.now()
        this.media = {}
        this.consumerLayers = {}
        this.stats = {}
    }
}

module.exports = Peer