const Peer = require('./peer');
const config = require('../config');

class Room {
  peers = {};

  router;

  audioLevelObserver;

  activeSpeaker = { producerId: null, volume: null, peerId: null };

  //          CREATE
  async createRouterAndObserver(router) {
    this.router = router;
    this.audioLevelObserver = await router.createAudioLevelObserver({
      interval: 800,
    });
    this.audioLevelObserver.on('volumes', (volumes) => {
      const { producer, volume } = volumes[0];
      console.log('audio-level volumes event', producer.appData.peerId, volume);
      this.activeSpeaker.producerId = producer.id;
      this.activeSpeaker.volume = volume;
      this.activeSpeaker.peerId = producer.appData.peerId;
    });
    this.audioLevelObserver.on('silence', () => {
      console.log('audio-level silence event');
      this.activeSpeaker.producerId = null;
      this.activeSpeaker.volume = null;
      this.activeSpeaker.peerId = null;
    });
  }

  async createWebRtcTransport({ peerId, direction }) {
    const {
      listenIps, initialAvailableOutgoingBitrate,
    } = config.mediasoup.webRtcTransport;
    const resp = await this.router.createWebRtcTransport({
      listenIps,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate,
      appData: { peerId, clientDirection: direction },
    });
    return resp;
  }

  async addProducerToAudioObserver(producerId) {
    await this.audioLevelObserver.addProducer({ producerId });
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
    const dumpedPeers = {};
    Object.values(this.peers).forEach((peer) => {
      dumpedPeers[peer.id] = peer.dumpSyncStatus();
    });
    return {
      peers: dumpedPeers, activeSpeaker: this.activeSpeaker,
    };
  }

  async updatePeerStats() {
    // Object.entries(this.peers).forEach(([idpeer])=>{
    //     await peer.updatePeerStats();
    // })
    if (this.peers) {
      Object.entries(this.peers).forEach((peer) => {
        peer.updateStats();
      });
    }
  }

  async deleteTimeOutedPeers() {
    const now = Date.now();
    Object.entries(this.peers).forEach(([id, p]) => {
      if ((now - p.lastSeenTs) > config.httpPeerStale) {
        console.log(`removing stale peer ${id}`);
        p.close(id);
        delete this.peers[p.id];
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
    // if (this.peers[peerId]) {
    //   throw Error('Already in room');
    // }
    this.peers[peerId] = new Peer(peerId, this);
    return { routerRtpCapabilities: this.router.rtpCapabilities };
  }

  async leave(peerId) {
    // --> /signaling/leave
    //
    // removes the peer from the roomState data structure and and closes
    // all associated mediasoup objects
    //
    const peer = this.peers[peerId];
    if (!peer) {
      throw Error('peer not found');
    }
    await peer.close();
    delete this.peers[peerId];
    return { left: true };
  }

  async peerSendTrack(peerID, transportId, kind, rtpParameters, appData, paused = false) {
    // --> /signaling/send-track
    //
    // called from inside a client's `transport.on('produce')` event handler.
    //
    const sendedPeer = this.findPeer(peerID);
    let targetTransport;
    Object.values(this.peers).forEach((peer) => {
      const pee = peer.findTransport(transportId, false);
      if (pee) {
        targetTransport = pee;
      }
    });
    if (!targetTransport) {
      throw Error(`send-track: server-side transport ${transportId} not found`);
    }
    const producer = await targetTransport.produce({
      kind, rtpParameters, paused, appData: { ...appData, peerId: peerID, transportId },
    });
    producer.on('transportclose', () => {
      sendedPeer.closeProducerObject(producer);
    });
    if (producer.kind === 'audio') {
      await this.addProducerToAudioObserver(producer.id);
      // audioLevelObserver.addProducer({producerId: producer.id});
    }
    sendedPeer.producers.push(producer);
    sendedPeer.media[appData.mediaTag] = {
      paused, encodings: rtpParameters.encodings,
    };
    return { id: producer.id };
  }

  async peerReceiveTrack(peerId, mediaPeerId, mediaTag, rtpCapabilities) {
    const senderPeer = this.findPeer(peerId);
    const targetPeer = this.findPeer(mediaPeerId);
    const allProducers = [...senderPeer.producers, ...targetPeer.producers];
    let targetProducer;
    allProducers.forEach((produce) => {
      if (produce.appData.mediaTag === mediaTag && produce.appData.peerId === mediaPeerId) {
        targetProducer = produce;
      }
    });
    if (!targetProducer) {
      throw Error(`recv-track: server-side producer for ${mediaPeerId}:${mediaTag} not found`);
    }

    if (!this.router.canConsume({
      producerId: targetProducer.id, rtpCapabilities,
    })) {
      const msg = `client cannot consume ${mediaPeerId}:${mediaTag}`;
      throw Error(`recv-track: ${peerId} ${msg}`);
    }

    const allTransports = { ...senderPeer.transports, ...targetPeer.transports };
    console.log(allTransports);
    let targetTransport;
    Object.values(allTransports).forEach((trans) => {
      if (trans.appData.peerId === peerId && trans.appData.clientDirection === 'recv') {
        targetTransport = trans;
      }
    });

    if (!targetTransport) {
      throw Error(`recv-track: server-side recv transport for ${this.id} not found`);
    }

    const targetConsumer = await targetTransport.consume({
      producerId: targetProducer.id,
      rtpCapabilities,
      paused: true, // see note above about always starting paused
      appData: { peerId, mediaPeerId, mediaTag },
    });
    targetConsumer.on('transportclose', () => {
      console.log('consumer\'s transport closed', targetConsumer.id);
      senderPeer.closeConsumerObject(targetConsumer);
    });
    targetConsumer.on('producerclose', () => {
      console.log('consumer\'s producer closed', targetConsumer.id);
      senderPeer.closeConsumerObject((targetConsumer));
    });
    senderPeer.consumers.push(targetConsumer);
    senderPeer.consumerLayers[targetConsumer.id] = {
      currentLayer: null, clientSelectedLayer: null,
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
      producerPaused: targetConsumer.producerPaused,
    };
  }

  //         HELPS
  findPeer(peerId, raise = true) {
    if (!this.peers[peerId] && raise) {
      throw Error(`Peer with id ${peerId} NOT found`);
    }
    return this.peers[peerId];
  }
}

module.exports = Room;
